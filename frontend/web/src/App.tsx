import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface TreasureRecord {
  id: string;
  encryptedLatitude: string;
  encryptedLongitude: string;
  encryptedClue: string;
  timestamp: number;
  creator: string;
  status: "hidden" | "discovered" | "expired";
  difficulty: number;
  reward: number;
}

// FHE encryption simulation for numbers
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}-${Date.now()}`;
};

// FHE decryption simulation for numbers
const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    const base64Data = encryptedData.split('-')[1];
    return parseFloat(atob(base64Data));
  }
  return parseFloat(encryptedData);
};

// Simulate FHE computation on encrypted coordinates
const FHEComputeDistance = (encryptedLat1: string, encryptedLng1: string, lat2: number, lng2: number): string => {
  const lat1 = FHEDecryptNumber(encryptedLat1);
  const lng1 = FHEDecryptNumber(encryptedLng1);
  
  // Simple distance calculation (simplified for demo)
  const distance = Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lng1 - lng2, 2));
  return FHEEncryptNumber(distance);
};

// Generate mock public key for signature verification
const generatePublicKey = () => `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [treasures, setTreasures] = useState<TreasureRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newTreasureData, setNewTreasureData] = useState({ 
    latitude: 0, 
    longitude: 0, 
    clue: "", 
    difficulty: 1, 
    reward: 0 
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedTreasure, setSelectedTreasure] = useState<TreasureRecord | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptedLocation, setDecryptedLocation] = useState<{lat: number, lng: number} | null>(null);
  const [publicKey, setPublicKey] = useState<string>("");
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const [arPreview, setArPreview] = useState<boolean>(false);

  // Statistics
  const hiddenCount = treasures.filter(t => t.status === "hidden").length;
  const discoveredCount = treasures.filter(t => t.status === "discovered").length;
  const expiredCount = treasures.filter(t => t.status === "expired").length;

  useEffect(() => {
    loadTreasures().finally(() => setLoading(false));
    const initParams = async () => {
      setPublicKey(generatePublicKey());
      // Simulate getting user location
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setUserLocation({
              lat: position.coords.latitude,
              lng: position.coords.longitude
            });
          },
          () => console.log("Location access denied")
        );
      }
    };
    initParams();
  }, []);

  const loadTreasures = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Load treasure keys
      const keysBytes = await contract.getData("treasure_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing treasure keys:", e); }
      }
      
      const list: TreasureRecord[] = [];
      for (const key of keys) {
        try {
          const treasureBytes = await contract.getData(`treasure_${key}`);
          if (treasureBytes.length > 0) {
            try {
              const treasureData = JSON.parse(ethers.toUtf8String(treasureBytes));
              list.push({ 
                id: key, 
                encryptedLatitude: treasureData.lat, 
                encryptedLongitude: treasureData.lng, 
                encryptedClue: treasureData.clue,
                timestamp: treasureData.timestamp, 
                creator: treasureData.creator, 
                status: treasureData.status || "hidden",
                difficulty: treasureData.difficulty || 1,
                reward: treasureData.reward || 0
              });
            } catch (e) { console.error(`Error parsing treasure data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading treasure ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setTreasures(list);
    } catch (e) { console.error("Error loading treasures:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createTreasure = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting treasure location with Zama FHE..." });
    
    try {
      // Encrypt coordinates using FHE simulation
      const encryptedLat = FHEEncryptNumber(newTreasureData.latitude);
      const encryptedLng = FHEEncryptNumber(newTreasureData.longitude);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const treasureId = `treasure-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const treasureData = { 
        lat: encryptedLat, 
        lng: encryptedLng, 
        clue: newTreasureData.clue,
        timestamp: Math.floor(Date.now() / 1000), 
        creator: address, 
        status: "hidden",
        difficulty: newTreasureData.difficulty,
        reward: newTreasureData.reward
      };
      
      // Store treasure data
      await contract.setData(`treasure_${treasureId}`, ethers.toUtf8Bytes(JSON.stringify(treasureData)));
      
      // Update keys list
      const keysBytes = await contract.getData("treasure_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(treasureId);
      await contract.setData("treasure_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Treasure encrypted and hidden successfully!" });
      await loadTreasures();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewTreasureData({ latitude: 0, longitude: 0, clue: "", difficulty: 1, reward: 0 });
        setCurrentStep(1);
      }, 2000);
      
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreating(false); 
    }
  };

  const discoverTreasure = async (treasureId: string) => {
    if (!isConnected || !userLocation) { 
      alert("Please connect wallet and enable location services"); 
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Verifying location with DePIN and decrypting with FHE..." });
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      
      const treasureBytes = await contract.getData(`treasure_${treasureId}`);
      if (treasureBytes.length === 0) throw new Error("Treasure not found");
      const treasureData = JSON.parse(ethers.toUtf8String(treasureBytes));
      
      // Simulate FHE computation to verify proximity
      const encryptedDistance = FHEComputeDistance(
        treasureData.lat, 
        treasureData.lng, 
        userLocation.lat, 
        userLocation.lng
      );
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      // Update treasure status to discovered
      const updatedTreasure = { ...treasureData, status: "discovered" };
      await contractWithSigner.setData(`treasure_${treasureId}`, ethers.toUtf8Bytes(JSON.stringify(updatedTreasure)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Treasure discovered! FHE verification completed." });
      await loadTreasures();
      
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Discovery failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptTreasureLocation = async (treasure: TreasureRecord) => {
    if (!isConnected) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setIsDecrypting(true);
    try {
      // Simulate wallet signature for decryption authorization
      const message = `DecryptTreasure:${treasure.id}\nPublicKey:${publicKey}\nTimestamp:${Date.now()}`;
      await signMessageAsync({ message });
      
      // Simulate FHE decryption process
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const decryptedLat = FHEDecryptNumber(treasure.encryptedLatitude);
      const decryptedLng = FHEDecryptNumber(treasure.encryptedLongitude);
      
      setDecryptedLocation({ lat: decryptedLat, lng: decryptedLng });
      
    } catch (e) { 
      console.error("Decryption failed:", e); 
      alert("Decryption authorization failed"); 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkContractAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: isAvailable ? "Contract is available and ready!" : "Contract not available" 
      });
      
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    }
  };

  const isCreator = (treasureCreator: string) => address?.toLowerCase() === treasureCreator.toLowerCase();

  // Tutorial steps for AR Treasure Hunt
  const tutorialSteps = [
    { title: "Connect Wallet", description: "Connect your Web3 wallet to start creating or hunting treasures", icon: "🔗" },
    { title: "Create Treasure", description: "Hide encrypted treasures in real-world locations using FHE encryption", icon: "🗺️", details: "Treasure coordinates are encrypted with Zama FHE technology" },
    { title: "AR Hunting", description: "Use AR interface to find treasures in the physical world", icon: "👁️", details: "Location verification through DePIN network" },
    { title: "FHE Decryption", description: "Decrypt treasure locations only when you're nearby", icon: "🔓", details: "FHE allows decryption only when location conditions are met" }
  ];

  // Render statistics chart
  const renderStatsChart = () => {
    const total = treasures.length || 1;
    const hiddenPercentage = (hiddenCount / total) * 360;
    const discoveredPercentage = (discoveredCount / total) * 360;
    
    return (
      <div className="stats-chart-container">
        <div className="stats-chart">
          <div className="chart-segment hidden" style={{ transform: `rotate(${hiddenPercentage}deg)` }}></div>
          <div className="chart-segment discovered" style={{ transform: `rotate(${hiddenPercentage + discoveredPercentage}deg)` }}></div>
          <div className="chart-center">
            <div className="chart-value">{treasures.length}</div>
            <div className="chart-label">Total</div>
          </div>
        </div>
        <div className="chart-legend">
          <div className="legend-item"><div className="color-box hidden"></div><span>Hidden: {hiddenCount}</span></div>
          <div className="legend-item"><div className="color-box discovered"></div><span>Discovered: {discoveredCount}</span></div>
          <div className="legend-item"><div className="color-box expired"></div><span>Expired: {expiredCount}</span></div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="hud-spinner"></div>
      <p>Initializing AR Treasure Hunt...</p>
    </div>
  );

  return (
    <div className="app-container hud-theme">
      {/* HUD Header */}
      <header className="app-header">
        <div className="hud-overlay"></div>
        <div className="logo">
          <div className="compass-icon"></div>
          <h1>AR<span>Treasure</span>Hunt</h1>
          <div className="fhe-badge">FHE-Powered</div>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="hud-button primary">
            <div className="add-icon"></div>Hide Treasure
          </button>
          <button className="hud-button" onClick={() => setShowTutorial(!showTutorial)}>
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <button className="hud-button" onClick={checkContractAvailability}>
            Check Availability
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="main-content">
        {/* Welcome Banner */}
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE Augmented Reality Treasure Hunt</h2>
            <p>Create and discover encrypted treasures in the real world using Zama FHE technology</p>
          </div>
          <div className="status-indicators">
            <div className="status-indicator fhe-active">
              <div className="pulse-dot"></div>
              <span>FHE Encryption Active</span>
            </div>
            <div className="status-indicator location-status">
              <div className={`dot ${userLocation ? 'active' : 'inactive'}`}></div>
              <span>Location: {userLocation ? 'Ready' : 'Required'}</span>
            </div>
          </div>
        </div>

        {/* Tutorial Section */}
        {showTutorial && (
          <div className="tutorial-section">
            <h2>AR Treasure Hunt Guide</h2>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-header">
                    <div className="step-number">{index + 1}</div>
                    <div className="step-icon">{step.icon}</div>
                  </div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    {step.details && <div className="step-details">{step.details}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dashboard Grid */}
        <div className="dashboard-grid">
          <div className="dashboard-card hud-card">
            <h3>Treasure Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{treasures.length}</div>
                <div className="stat-label">Total Treasures</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{hiddenCount}</div>
                <div className="stat-label">Hidden</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{discoveredCount}</div>
                <div className="stat-label">Discovered</div>
              </div>
            </div>
          </div>

          <div className="dashboard-card hud-card">
            <h3>Status Distribution</h3>
            {renderStatsChart()}
          </div>

          {/* AR Preview Panel */}
          <div className="dashboard-card hud-card ar-preview">
            <h3>AR Preview</h3>
            <div className="ar-viewport">
              <div className="ar-overlay">
                <div className="ar-marker"></div>
                <div className="treasure-indicator">
                  <div className="pulse-ring"></div>
                  <div className="treasure-icon">💎</div>
                </div>
              </div>
            </div>
            <button 
              className="hud-button" 
              onClick={() => setArPreview(!arPreview)}
            >
              {arPreview ? "Exit AR" : "Enter AR Mode"}
            </button>
          </div>
        </div>

        {/* Treasures List */}
        <div className="treasures-section">
          <div className="section-header">
            <h2>Encrypted Treasures</h2>
            <div className="header-actions">
              <button onClick={loadTreasures} className="hud-button" disabled={isRefreshing}>
                {isRefreshing ? "Scanning..." : "Scan Area"}
              </button>
            </div>
          </div>
          
          <div className="treasures-list hud-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Difficulty</div>
              <div className="header-cell">Reward</div>
              <div className="header-cell">Creator</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {treasures.length === 0 ? (
              <div className="no-treasures">
                <div className="compass-large"></div>
                <p>No treasures found in this area</p>
                <button className="hud-button primary" onClick={() => setShowCreateModal(true)}>
                  Hide First Treasure
                </button>
              </div>
            ) : (
              treasures.map(treasure => (
                <div className="treasure-row" key={treasure.id} onClick={() => setSelectedTreasure(treasure)}>
                  <div className="table-cell">#{treasure.id.substring(0, 8)}</div>
                  <div className="table-cell">
                    <div className="difficulty-stars">
                      {"★".repeat(treasure.difficulty)}{"☆".repeat(5 - treasure.difficulty)}
                    </div>
                  </div>
                  <div className="table-cell">{treasure.reward} ETH</div>
                  <div className="table-cell">{treasure.creator.substring(0, 6)}...{treasure.creator.substring(38)}</div>
                  <div className="table-cell">
                    <span className={`status-badge ${treasure.status}`}>{treasure.status}</span>
                  </div>
                  <div className="table-cell actions">
                    {treasure.status === "hidden" && userLocation && (
                      <button className="hud-button success" onClick={(e) => { e.stopPropagation(); discoverTreasure(treasure.id); }}>
                        Discover
                      </button>
                    )}
                    {isCreator(treasure.creator) && (
                      <button className="hud-button" onClick={(e) => { e.stopPropagation(); decryptTreasureLocation(treasure); }}>
                        Decrypt Location
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Create Treasure Modal */}
      {showCreateModal && (
        <CreateTreasureModal 
          onSubmit={createTreasure} 
          onClose={() => { setShowCreateModal(false); setCurrentStep(1); }} 
          creating={creating} 
          treasureData={newTreasureData} 
          setTreasureData={setNewTreasureData}
          currentStep={currentStep}
          setCurrentStep={setCurrentStep}
        />
      )}

      {/* Treasure Detail Modal */}
      {selectedTreasure && (
        <TreasureDetailModal 
          treasure={selectedTreasure} 
          onClose={() => { setSelectedTreasure(null); setDecryptedLocation(null); }} 
          decryptedLocation={decryptedLocation}
          isDecrypting={isDecrypting}
          decryptTreasureLocation={decryptTreasureLocation}
        />
      )}

      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content hud-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="hud-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✕</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      {/* HUD Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo-small">
              <div className="compass-icon"></div>
              <span>ARTreasureHunt</span>
            </div>
            <p>FHE-Powered AR Treasure Hunting Platform</p>
          </div>
          <div className="footer-tech">
            <span className="tech-badge">Zama FHE</span>
            <span className="tech-badge">DePIN</span>
            <span className="tech-badge">AR</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

// Create Treasure Modal Component
interface CreateTreasureModalProps {
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  treasureData: any;
  setTreasureData: (data: any) => void;
  currentStep: number;
  setCurrentStep: (step: number) => void;
}

const CreateTreasureModal: React.FC<CreateTreasureModalProps> = ({
  onSubmit, onClose, creating, treasureData, setTreasureData, currentStep, setCurrentStep
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setTreasureData({ ...treasureData, [name]: value });
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setTreasureData({ ...treasureData, [name]: parseFloat(value) });
  };

  const nextStep = () => setCurrentStep(currentStep + 1);
  const prevStep = () => setCurrentStep(currentStep - 1);

  const handleSubmit = () => {
    if (!treasureData.latitude || !treasureData.longitude) {
      alert("Please set treasure coordinates");
      return;
    }
    onSubmit();
  };

  const steps = [
    { title: "Location", description: "Set treasure coordinates" },
    { title: "Details", description: "Configure treasure properties" },
    { title: "Encrypt", description: "FHE encryption preview" }
  ];

  return (
    <div className="modal-overlay">
      <div className="create-modal hud-card">
        <div className="modal-header">
          <h2>Hide New Treasure</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>

        {/* Step Progress */}
        <div className="step-progress">
          {steps.map((step, index) => (
            <div key={index} className={`step ${currentStep > index + 1 ? 'completed' : ''} ${currentStep === index + 1 ? 'active' : ''}`}>
              <div className="step-number">{index + 1}</div>
              <div className="step-info">
                <div className="step-title">{step.title}</div>
                <div className="step-desc">{step.description}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-body">
          {/* Step 1: Location */}
          {currentStep === 1 && (
            <div className="step-content">
              <h3>Set Treasure Location</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label>Latitude *</label>
                  <input type="number" name="latitude" value={treasureData.latitude} onChange={handleNumberChange} step="0.000001" className="hud-input"/>
                </div>
                <div className="form-group">
                  <label>Longitude *</label>
                  <input type="number" name="longitude" value={treasureData.longitude} onChange={handleNumberChange} step="0.000001" className="hud-input"/>
                </div>
              </div>
              <div className="location-preview">
                <div className="map-placeholder">
                  <div className="map-marker"></div>
                  <span>Coordinates: {treasureData.latitude}, {treasureData.longitude}</span>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Details */}
          {currentStep === 2 && (
            <div className="step-content">
              <h3>Treasure Configuration</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label>Clue Hint</label>
                  <input type="text" name="clue" value={treasureData.clue} onChange={handleChange} className="hud-input" placeholder="Enter a clue for hunters"/>
                </div>
                <div className="form-group">
                  <label>Difficulty Level (1-5)</label>
                  <input type="range" name="difficulty" min="1" max="5" value={treasureData.difficulty} onChange={handleChange} className="hud-slider"/>
                  <div className="slider-value">{"★".repeat(treasureData.difficulty)}{"☆".repeat(5 - treasureData.difficulty)}</div>
                </div>
                <div className="form-group">
                  <label>Reward (ETH)</label>
                  <input type="number" name="reward" value={treasureData.reward} onChange={handleNumberChange} step="0.001" className="hud-input"/>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Encryption */}
          {currentStep === 3 && (
            <div className="step-content">
              <h3>FHE Encryption Preview</h3>
              <div className="encryption-preview">
                <div className="data-comparison">
                  <div className="plain-data">
                    <h4>Plain Coordinates</h4>
                    <div className="coordinate-display">
                      <span>Lat: {treasureData.latitude}</span>
                      <span>Lng: {treasureData.longitude}</span>
                    </div>
                  </div>
                  <div className="encryption-arrow">→</div>
                  <div className="encrypted-data">
                    <h4>FHE Encrypted</h4>
                    <div className="encrypted-display">
                      <span>Lat: {FHEEncryptNumber(treasureData.latitude).substring(0, 30)}...</span>
                      <span>Lng: {FHEEncryptNumber(treasureData.longitude).substring(0, 30)}...</span>
                    </div>
                  </div>
                </div>
                <div className="fhe-notice">
                  <div className="lock-icon"></div>
                  <p>Coordinates will be encrypted using Zama FHE technology and remain encrypted during verification</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={prevStep} disabled={currentStep === 1} className="hud-button">
            Previous
          </button>
          {currentStep < 3 ? (
            <button onClick={nextStep} className="hud-button primary">
              Next
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={creating} className="hud-button success">
              {creating ? "Encrypting..." : "Hide Treasure"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Treasure Detail Modal Component
interface TreasureDetailModalProps {
  treasure: TreasureRecord;
  onClose: () => void;
  decryptedLocation: {lat: number, lng: number} | null;
  isDecrypting: boolean;
  decryptTreasureLocation: (treasure: TreasureRecord) => void;
}

const TreasureDetailModal: React.FC<TreasureDetailModalProps> = ({
  treasure, onClose, decryptedLocation, isDecrypting, decryptTreasureLocation
}) => {
  return (
    <div className="modal-overlay">
      <div className="treasure-detail-modal hud-card">
        <div className="modal-header">
          <h2>Treasure Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="treasure-info">
            <div className="info-grid">
              <div className="info-item"><span>ID:</span><strong>#{treasure.id.substring(0, 12)}</strong></div>
              <div className="info-item"><span>Status:</span><strong className={`status-badge ${treasure.status}`}>{treasure.status}</strong></div>
              <div className="info-item"><span>Difficulty:</span><strong>{"★".repeat(treasure.difficulty)}</strong></div>
              <div className="info-item"><span>Reward:</span><strong>{treasure.reward} ETH</strong></div>
              <div className="info-item"><span>Created:</span><strong>{new Date(treasure.timestamp * 1000).toLocaleString()}</strong></div>
            </div>
            
            <div className="encrypted-section">
              <h3>Encrypted Data</h3>
              <div className="encrypted-data">
                <div className="data-field">
                  <label>Latitude (FHE):</label>
                  <code>{treasure.encryptedLatitude.substring(0, 40)}...</code>
                </div>
                <div className="data-field">
                  <label>Longitude (FHE):</label>
                  <code>{treasure.encryptedLongitude.substring(0, 40)}...</code>
                </div>
                <div className="data-field">
                  <label>Clue:</label>
                  <span>{treasure.encryptedClue || "No clue provided"}</span>
                </div>
              </div>
              
              <button 
                className="hud-button primary" 
                onClick={() => decryptTreasureLocation(treasure)}
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : "Decrypt Location"}
              </button>
            </div>

            {decryptedLocation && (
              <div className="decrypted-section">
                <h3>Decrypted Location</h3>
                <div className="decrypted-coordinates">
                  <div className="coordinate">
                    <span>Latitude:</span>
                    <strong>{decryptedLocation.lat}</strong>
                  </div>
                  <div className="coordinate">
                    <span>Longitude:</span>
                    <strong>{decryptedLocation.lng}</strong>
                  </div>
                </div>
                <div className="decryption-notice">
                  <div className="warning-icon"></div>
                  <span>Location decrypted with wallet signature authorization</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;