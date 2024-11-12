# DIMO Transactions SDK

The DIMO transactions SDK was created to help developers build on DIMO.

## Installation

Use [npm](https://www.npmjs.com/package/@dimo-network/transactions):

```bash
npm install @dimo-network/transactions
```

## How to Use the SDK

There are two types of client signers that a developer can use:

| Functionality       | Account Client                 | Kernel Client                                       |
| ------------------- | ------------------------------ | --------------------------------------------------- |
| Initializing signer | Initialized with a private key | Initialized with private key or stamper             |
| Signing as          | Wallet owned by private key    | Account Abstracted wallet controlled by private key |

If you're a developer interested in using the DIMO Transactions SDK for personal use, such as sending on-chain transactions with a wallet that you hold the private key for, the **Account Client** is for you. The Account Client has fewer features because it is intended for individual use. Some actions you might take with this client include sending DIMO tokens from your wallet, minting a vehicle, or transferring vehicles. See below for an example:

#### Sending DIMO Tokens with an Account Signer

```js
    import { AccountSigner, newKernelConfig } from '@dimo-network/transactions';
    import {privateKeyToAccount} from 'viem/accounts';

    const account = privateKeyToAccount(your_private_key as `0x${string}`);

    const signer = new AccountSigner({
        rpcURL: RPC_URL,
        account: account,
        environment: 'dev', // omit to default to prod
    });

    const txHash = signer.sendDIMOTokens({
        recipient: '0x_recipient_addr_here',
        amount: BigInt(10),
    });

```

If you're a developer interested in using the DIMO Transactions SDK for **multi-user** or **corporate** purposes, where you will want to prompt **DIMO users** to take actions on their own accounts, the **Kernel Client** is for you. Kernel Clients are intended to work with **DIMOs Global Accounts**, security-improved wallets that reduce fees for users, enable account recorvery options, and create a more flexible ecosystem for developers to build on DIMO. See below for an example:

#### Setting Vehicle Permissions with a Kernel Signer

##### This example demonstrates using a PasskeyStamer but you can use:

- WebauthnStamper (@turnkey/webauthn-stamper)
- IframeStamper (@turnkey/iframe-stamper)
- ApiKeyStamper (@turnkey/api-key-stamper)

```js
    import { PasskeyStamper } from "@turnkey/react-native-passkey-stamper";
    import { KernelSigner, newKernelConfig, sacdPermissionValue } from '@dimo-network/transactions';

    const kernelSignerConfig = newKernelConfig({
        rpcUrl: RPC_URL,
        bundlerUrl: BUNDLER_RPC,
        paymasterUrl: PAYMASTER_RPC,
        environment: 'dev', // omit to default to prod
    });

    // NOTE: use the correct stamper for your framework
    const stamper = new PasskeyStamper({
        rpId: RPID,
    });

    const kernelSigner = new KernelSigner(kernelSignerConfig);
    await kernelSigner.passkeyInit(
        subOrganizationId,
        walletAddress as `0x${string}`,
        stamper,
    );

    const perms = sacdPermissionValue({
        ALLTIME_LOCATION: true,
    });

    const {success, reason, receipt} = await kernelSigner.setVehiclePermissions({
        tokenId: tokenId,
        grantee: grantee,
        permissions: BigInt(perms),
        expiration: expiration,
        source: source,
      });
```

### Actions

The Kernel Client can take the following actions:

- Open a wallet session (wallet session must be specified in config; default timeout is 15 mintes)
  `kernelClient.openSessionWithPasskey()`
- Mint a vehicle with device definition
  - This function can accept a single `MintVehicleWithDeviceDefinition` object or an array of objects
    `kernelClient.mintVehicleWithDeviceDefinition(args)`

### Contributing:

To build the `.tgz` file, run the following:

- npm run build
- npm pack
