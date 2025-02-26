import { Abi } from "viem";

export const abiWormholeNttManager: Abi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_token",
        type: "address"
      },
      {
        internalType: "enum IManagerBase.Mode",
        name: "_mode",
        type: "uint8"
      },
      {
        internalType: "uint16",
        name: "_chainId",
        type: "uint16"
      },
      {
        internalType: "uint64",
        name: "_rateLimitDuration",
        type: "uint64"
      },
      {
        internalType: "bool",
        name: "_skipRateLimiting",
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "burnAmount",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "balanceDiff",
        type: "uint256"
      }
    ],
    name: "BurnAmountDifferentThanBalanceDiff",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "caller",
        type: "address"
      }
    ],
    name: "CallerNotTransceiver",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "canceller",
        type: "address"
      },
      {
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "CancellerNotSender",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "TrimmedAmount",
        name: "newCurrentCapacity",
        type: "uint72"
      },
      {
        internalType: "TrimmedAmount",
        name: "newLimit",
        type: "uint72"
      }
    ],
    name: "CapacityCannotExceedLimit",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "requiredPayment",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "providedPayment",
        type: "uint256"
      }
    ],
    name: "DeliveryPaymentTooLow",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "transceiver",
        type: "address"
      }
    ],
    name: "DisabledTransceiver",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "digest",
        type: "bytes32"
      }
    ],
    name: "InboundQueuedTransferNotFound",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "digest",
        type: "bytes32"
      },
      {
        internalType: "uint256",
        name: "transferTimestamp",
        type: "uint256"
      }
    ],
    name: "InboundQueuedTransferStillQueued",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "evmChainId",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "blockChainId",
        type: "uint256"
      }
    ],
    name: "InvalidFork",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidInitialization",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "mode",
        type: "uint8"
      }
    ],
    name: "InvalidMode",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "InvalidPauser",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "chainId",
        type: "uint16"
      },
      {
        internalType: "bytes32",
        name: "peerAddress",
        type: "bytes32"
      }
    ],
    name: "InvalidPeer",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidPeerChainIdZero",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidPeerDecimals",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidPeerSameChainId",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidPeerZeroAddress",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidRecipient",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidRefundAddress",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "targetChain",
        type: "uint16"
      },
      {
        internalType: "uint16",
        name: "thisChain",
        type: "uint16"
      }
    ],
    name: "InvalidTargetChain",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidTransceiverZeroAddress",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "msgHash",
        type: "bytes32"
      }
    ],
    name: "MessageNotApproved",
    type: "error"
  },
  {
    inputs: [],
    name: "NoEnabledTransceivers",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "transceiver",
        type: "address"
      }
    ],
    name: "NonRegisteredTransceiver",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    name: "NotAnEvmAddress",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "currentCapacity",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "NotEnoughCapacity",
    type: "error"
  },
  {
    inputs: [],
    name: "NotImplemented",
    type: "error"
  },
  {
    inputs: [],
    name: "NotInitializing",
    type: "error"
  },
  {
    inputs: [],
    name: "NotMigrating",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "decimals",
        type: "uint8"
      },
      {
        internalType: "uint8",
        name: "decimalsOther",
        type: "uint8"
      }
    ],
    name: "NumberOfDecimalsNotEqual",
    type: "error"
  },
  {
    inputs: [],
    name: "OnlyDelegateCall",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "queueSequence",
        type: "uint64"
      }
    ],
    name: "OutboundQueuedTransferNotFound",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "queueSequence",
        type: "uint64"
      },
      {
        internalType: "uint256",
        name: "transferTimestamp",
        type: "uint256"
      }
    ],
    name: "OutboundQueuedTransferStillQueued",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "OwnableInvalidOwner",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "OwnableUnauthorizedAccount",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "chainId",
        type: "uint16"
      }
    ],
    name: "PeerNotRegistered",
    type: "error"
  },
  {
    inputs: [],
    name: "ReentrancyGuardReentrantCall",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "refundAmount",
        type: "uint256"
      }
    ],
    name: "RefundFailed",
    type: "error"
  },
  {
    inputs: [],
    name: "RequireContractIsNotPaused",
    type: "error"
  },
  {
    inputs: [],
    name: "RequireContractIsPaused",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "retrieved",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "registered",
        type: "uint256"
      }
    ],
    name: "RetrievedIncorrectRegisteredTransceivers",
    type: "error"
  },
  {
    inputs: [],
    name: "StaticcallFailed",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "threshold",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "transceivers",
        type: "uint256"
      }
    ],
    name: "ThresholdTooHigh",
    type: "error"
  },
  {
    inputs: [],
    name: "TooManyTransceivers",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "nttManagerMessageHash",
        type: "bytes32"
      }
    ],
    name: "TransceiverAlreadyAttestedToMessage",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "transceiver",
        type: "address"
      }
    ],
    name: "TransceiverAlreadyEnabled",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "dust",
        type: "uint256"
      }
    ],
    name: "TransferAmountHasDust",
    type: "error"
  },
  {
    inputs: [],
    name: "UndefinedRateLimiting",
    type: "error"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "expectedOwner",
        type: "address"
      },
      {
        internalType: "address",
        name: "owner",
        type: "address"
      }
    ],
    name: "UnexpectedDeployer",
    type: "error"
  },
  {
    inputs: [],
    name: "UnexpectedMsgValue",
    type: "error"
  },
  {
    inputs: [],
    name: "ZeroAmount",
    type: "error"
  },
  {
    inputs: [],
    name: "ZeroThreshold",
    type: "error"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "previousAdmin",
        type: "address"
      },
      {
        indexed: false,
        internalType: "address",
        name: "newAdmin",
        type: "address"
      }
    ],
    name: "AdminChanged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "beacon",
        type: "address"
      }
    ],
    name: "BeaconUpgraded",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint16",
        name: "chainId",
        type: "uint16"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "oldLimit",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "newLimit",
        type: "uint256"
      }
    ],
    name: "InboundTransferLimitUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bytes32",
        name: "digest",
        type: "bytes32"
      }
    ],
    name: "InboundTransferQueued",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint64",
        name: "version",
        type: "uint64"
      }
    ],
    name: "Initialized",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "sourceNttManager",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "msgHash",
        type: "bytes32"
      }
    ],
    name: "MessageAlreadyExecuted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bytes32",
        name: "digest",
        type: "bytes32"
      },
      {
        indexed: false,
        internalType: "address",
        name: "transceiver",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "index",
        type: "uint8"
      }
    ],
    name: "MessageAttestedTo",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bool",
        name: "notPaused",
        type: "bool"
      }
    ],
    name: "NotPaused",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "sequence",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "address",
        name: "recipient",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "OutboundTransferCancelled",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "oldLimit",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "newLimit",
        type: "uint256"
      }
    ],
    name: "OutboundTransferLimitUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint64",
        name: "queueSequence",
        type: "uint64"
      }
    ],
    name: "OutboundTransferQueued",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "sequence",
        type: "uint64"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "currentCapacity",
        type: "uint256"
      }
    ],
    name: "OutboundTransferRateLimited",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "OwnershipTransferred",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bool",
        name: "paused",
        type: "bool"
      }
    ],
    name: "Paused",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "oldPauser",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "newPauser",
        type: "address"
      }
    ],
    name: "PauserTransferred",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint16",
        name: "chainId_",
        type: "uint16"
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "oldPeerContract",
        type: "bytes32"
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "oldPeerDecimals",
        type: "uint8"
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "peerContract",
        type: "bytes32"
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "peerDecimals",
        type: "uint8"
      }
    ],
    name: "PeerUpdated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint8",
        name: "oldThreshold",
        type: "uint8"
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "threshold",
        type: "uint8"
      }
    ],
    name: "ThresholdChanged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "transceiver",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "transceiversNum",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "threshold",
        type: "uint8"
      }
    ],
    name: "TransceiverAdded",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "transceiver",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "threshold",
        type: "uint8"
      }
    ],
    name: "TransceiverRemoved",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "digest",
        type: "bytes32"
      }
    ],
    name: "TransferRedeemed",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "recipient",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "refundAddress",
        type: "bytes32"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "fee",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint16",
        name: "recipientChain",
        type: "uint16"
      },
      {
        indexed: false,
        internalType: "uint64",
        name: "msgSequence",
        type: "uint64"
      }
    ],
    name: "TransferSent",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "digest",
        type: "bytes32"
      }
    ],
    name: "TransferSent",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "implementation",
        type: "address"
      }
    ],
    name: "Upgraded",
    type: "event"
  },
  {
    inputs: [],
    name: "NTT_MANAGER_VERSION",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "sourceChainId",
        type: "uint16"
      },
      {
        internalType: "bytes32",
        name: "sourceNttManagerAddress",
        type: "bytes32"
      },
      {
        components: [
          {
            internalType: "bytes32",
            name: "id",
            type: "bytes32"
          },
          {
            internalType: "bytes32",
            name: "sender",
            type: "bytes32"
          },
          {
            internalType: "bytes",
            name: "payload",
            type: "bytes"
          }
        ],
        internalType: "struct TransceiverStructs.NttManagerMessage",
        name: "payload",
        type: "tuple"
      }
    ],
    name: "attestationReceived",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "messageSequence",
        type: "uint64"
      }
    ],
    name: "cancelOutboundQueuedTransfer",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "chainId",
    outputs: [
      {
        internalType: "uint16",
        name: "",
        type: "uint16"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "digest",
        type: "bytes32"
      }
    ],
    name: "completeInboundQueuedTransfer",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "messageSequence",
        type: "uint64"
      }
    ],
    name: "completeOutboundQueuedTransfer",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "sourceChainId",
        type: "uint16"
      },
      {
        internalType: "bytes32",
        name: "sourceNttManagerAddress",
        type: "bytes32"
      },
      {
        components: [
          {
            internalType: "bytes32",
            name: "id",
            type: "bytes32"
          },
          {
            internalType: "bytes32",
            name: "sender",
            type: "bytes32"
          },
          {
            internalType: "bytes",
            name: "payload",
            type: "bytes"
          }
        ],
        internalType: "struct TransceiverStructs.NttManagerMessage",
        name: "message",
        type: "tuple"
      }
    ],
    name: "executeMsg",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "chainId_",
        type: "uint16"
      }
    ],
    name: "getCurrentInboundCapacity",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getCurrentOutboundCapacity",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "chainId_",
        type: "uint16"
      }
    ],
    name: "getInboundLimitParams",
    outputs: [
      {
        components: [
          {
            internalType: "TrimmedAmount",
            name: "limit",
            type: "uint72"
          },
          {
            internalType: "TrimmedAmount",
            name: "currentCapacity",
            type: "uint72"
          },
          {
            internalType: "uint64",
            name: "lastTxTimestamp",
            type: "uint64"
          }
        ],
        internalType: "struct IRateLimiter.RateLimitParams",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "digest",
        type: "bytes32"
      }
    ],
    name: "getInboundQueuedTransfer",
    outputs: [
      {
        components: [
          {
            internalType: "TrimmedAmount",
            name: "amount",
            type: "uint72"
          },
          {
            internalType: "uint64",
            name: "txTimestamp",
            type: "uint64"
          },
          {
            internalType: "address",
            name: "recipient",
            type: "address"
          }
        ],
        internalType: "struct IRateLimiter.InboundQueuedTransfer",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getMigratesImmutables",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getMode",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getOutboundLimitParams",
    outputs: [
      {
        components: [
          {
            internalType: "TrimmedAmount",
            name: "limit",
            type: "uint72"
          },
          {
            internalType: "TrimmedAmount",
            name: "currentCapacity",
            type: "uint72"
          },
          {
            internalType: "uint64",
            name: "lastTxTimestamp",
            type: "uint64"
          }
        ],
        internalType: "struct IRateLimiter.RateLimitParams",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint64",
        name: "queueSequence",
        type: "uint64"
      }
    ],
    name: "getOutboundQueuedTransfer",
    outputs: [
      {
        components: [
          {
            internalType: "bytes32",
            name: "recipient",
            type: "bytes32"
          },
          {
            internalType: "bytes32",
            name: "refundAddress",
            type: "bytes32"
          },
          {
            internalType: "TrimmedAmount",
            name: "amount",
            type: "uint72"
          },
          {
            internalType: "uint64",
            name: "txTimestamp",
            type: "uint64"
          },
          {
            internalType: "uint16",
            name: "recipientChain",
            type: "uint16"
          },
          {
            internalType: "address",
            name: "sender",
            type: "address"
          },
          {
            internalType: "bytes",
            name: "transceiverInstructions",
            type: "bytes"
          }
        ],
        internalType: "struct IRateLimiter.OutboundQueuedTransfer",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "chainId_",
        type: "uint16"
      }
    ],
    name: "getPeer",
    outputs: [
      {
        components: [
          {
            internalType: "bytes32",
            name: "peerAddress",
            type: "bytes32"
          },
          {
            internalType: "uint8",
            name: "tokenDecimals",
            type: "uint8"
          }
        ],
        internalType: "struct INttManager.NttManagerPeer",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getThreshold",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getTransceiverInfo",
    outputs: [
      {
        components: [
          {
            internalType: "bool",
            name: "registered",
            type: "bool"
          },
          {
            internalType: "bool",
            name: "enabled",
            type: "bool"
          },
          {
            internalType: "uint8",
            name: "index",
            type: "uint8"
          }
        ],
        internalType: "struct TransceiverRegistry.TransceiverInfo[]",
        name: "",
        type: "tuple[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getTransceivers",
    outputs: [
      {
        internalType: "address[]",
        name: "result",
        type: "address[]"
      }
    ],
    stateMutability: "pure",
    type: "function"
  },
  {
    inputs: [],
    name: "initialize",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "digest",
        type: "bytes32"
      }
    ],
    name: "isMessageApproved",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "digest",
        type: "bytes32"
      }
    ],
    name: "isMessageExecuted",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "isPaused",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "digest",
        type: "bytes32"
      }
    ],
    name: "messageAttestations",
    outputs: [
      {
        internalType: "uint8",
        name: "count",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "migrate",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "mode",
    outputs: [
      {
        internalType: "enum IManagerBase.Mode",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "nextMessageSequence",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "pauser",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "recipientChain",
        type: "uint16"
      },
      {
        internalType: "bytes",
        name: "transceiverInstructions",
        type: "bytes"
      }
    ],
    name: "quoteDeliveryPrice",
    outputs: [
      {
        internalType: "uint256[]",
        name: "",
        type: "uint256[]"
      },
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "rateLimitDuration",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "transceiver",
        type: "address"
      }
    ],
    name: "removeTransceiver",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "limit",
        type: "uint256"
      },
      {
        internalType: "uint16",
        name: "chainId_",
        type: "uint16"
      }
    ],
    name: "setInboundLimit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "limit",
        type: "uint256"
      }
    ],
    name: "setOutboundLimit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "peerChainId",
        type: "uint16"
      },
      {
        internalType: "bytes32",
        name: "peerContract",
        type: "bytes32"
      },
      {
        internalType: "uint8",
        name: "decimals",
        type: "uint8"
      },
      {
        internalType: "uint256",
        name: "inboundLimit",
        type: "uint256"
      }
    ],
    name: "setPeer",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "threshold",
        type: "uint8"
      }
    ],
    name: "setThreshold",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "transceiver",
        type: "address"
      }
    ],
    name: "setTransceiver",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "token",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "tokenDecimals",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "digest",
        type: "bytes32"
      },
      {
        internalType: "uint8",
        name: "index",
        type: "uint8"
      }
    ],
    name: "transceiverAttestedToMessage",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "uint16",
        name: "recipientChain",
        type: "uint16"
      },
      {
        internalType: "bytes32",
        name: "recipient",
        type: "bytes32"
      }
    ],
    name: "transfer",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        internalType: "uint16",
        name: "recipientChain",
        type: "uint16"
      },
      {
        internalType: "bytes32",
        name: "recipient",
        type: "bytes32"
      },
      {
        internalType: "bytes32",
        name: "refundAddress",
        type: "bytes32"
      },
      {
        internalType: "bool",
        name: "shouldQueue",
        type: "bool"
      },
      {
        internalType: "bytes",
        name: "transceiverInstructions",
        type: "bytes"
      }
    ],
    name: "transfer",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newOwner",
        type: "address"
      }
    ],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newPauser",
        type: "address"
      }
    ],
    name: "transferPauserCapability",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "unpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newImplementation",
        type: "address"
      }
    ],
    name: "upgrade",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];