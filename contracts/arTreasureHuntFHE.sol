pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ArTreasureHuntFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds;
    bool public paused;
    uint256 public currentBatchId;
    bool public batchOpen;

    struct Treasure {
        euint32 encryptedLatitude;
        euint32 encryptedLongitude;
        euint32 encryptedCluePart1;
        euint32 encryptedCluePart2;
    }
    mapping(uint256 => Treasure) public treasures; // batchId -> Treasure
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event ContractPaused(address indexed account);
    event ContractUnpaused(address indexed account);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event TreasureSubmitted(address indexed provider, uint256 indexed batchId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 latitude, uint256 longitude, uint256 cluePart1, uint256 cluePart2);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error TreasureNotSet();
    error ReplayDetected();
    error StateMismatch();
    error InvalidBatchId();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        cooldownSeconds = 60; // Default cooldown
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        isProvider[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        delete isProvider[provider];
        emit ProviderRemoved(provider);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchNotOpen();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitTreasure(
        euint32 _encryptedLatitude,
        euint32 _encryptedLongitude,
        euint32 _encryptedCluePart1,
        euint32 _encryptedCluePart2
    ) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (!batchOpen) revert BatchNotOpen();
        _initIfNeeded(_encryptedLatitude);
        _initIfNeeded(_encryptedLongitude);
        _initIfNeeded(_encryptedCluePart1);
        _initIfNeeded(_encryptedCluePart2);

        treasures[currentBatchId] = Treasure({
            encryptedLatitude: _encryptedLatitude,
            encryptedLongitude: _encryptedLongitude,
            encryptedCluePart1: _encryptedCluePart1,
            encryptedCluePart2: _encryptedCluePart2
        });
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit TreasureSubmitted(msg.sender, currentBatchId);
    }

    function requestTreasureDecryption(uint256 _batchId) external whenNotPaused checkDecryptionCooldown {
        if (_batchId == 0 || _batchId > currentBatchId) revert InvalidBatchId();
        Treasure storage t = treasures[_batchId];
        if (!_isInitialized(t.encryptedLatitude)) revert TreasureNotSet();

        euint32[] memory ctsArray = new euint32[](4);
        ctsArray[0] = t.encryptedLatitude;
        ctsArray[1] = t.encryptedLongitude;
        ctsArray[2] = t.encryptedCluePart1;
        ctsArray[3] = t.encryptedCluePart2;

        bytes32 stateHash = _hashCiphertexts(ctsArray);
        uint256 requestId = FHE.requestDecryption(ctsArray, this.myCallback.selector);
        decryptionContexts[requestId] = DecryptionContext({ batchId: _batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, _batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();
        if (decryptionContexts[requestId].batchId == 0 || decryptionContexts[requestId].batchId > currentBatchId) revert InvalidBatchId();

        uint256 _batchId = decryptionContexts[requestId].batchId;
        Treasure storage t = treasures[_batchId];
        if (!_isInitialized(t.encryptedLatitude)) revert TreasureNotSet();

        euint32[] memory ctsArray = new euint32[](4);
        ctsArray[0] = t.encryptedLatitude;
        ctsArray[1] = t.encryptedLongitude;
        ctsArray[2] = t.encryptedCluePart1;
        ctsArray[3] = t.encryptedCluePart2;

        bytes32 currentHash = _hashCiphertexts(ctsArray);
        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();
        FHE.checkSignatures(requestId, cleartexts, proof);

        (uint256 latitude, uint256 longitude, uint256 cluePart1, uint256 cluePart2) = abi.decode(cleartexts, (uint256, uint256, uint256, uint256));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, _batchId, latitude, longitude, cluePart1, cluePart2);
    }

    function _hashCiphertexts(euint32[] memory ctsArray) internal pure returns (bytes32) {
        bytes32[4] memory ctsAsBytes32;
        for (uint i = 0; i < ctsArray.length; i++) {
            ctsAsBytes32[i] = FHE.toBytes32(ctsArray[i]);
        }
        return keccak256(abi.encode(ctsAsBytes32, address(this)));
    }

    function _initIfNeeded(euint32 val) internal pure {
        if (!_isInitialized(val)) {
            val = FHE.asEuint32(0);
        }
    }

    function _isInitialized(euint32 val) internal pure returns (bool) {
        return FHE.isInitialized(val);
    }
}