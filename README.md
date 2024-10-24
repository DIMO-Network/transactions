# DIMO Transactions SDK

## Installation

Use [npm](https://www.npmjs.com/package/@dimo-network/transactions):

```bash
npm install @dimo-network/transactions
```

## How to Use the SDK

Using the SDK with an account signer:

```js
    import { AccountSigner, newKernelConfig } from '@dimo-network/transactions';
    import {privateKeyToAccount} from 'viem/accounts';

    const account = privateKeyToAccount(your_private_key as `0x${string}`);

    const signer = new AccountSigner({
        rpcURL: RPC_URL,
        account: account,
        environment: 'dev', // omit this to default to prod
    });

    const txHash = signer.sendDIMOTokens({
        recipient: '0x_recipient_addr_here',
        amount: BigInt(10),
    });

```

## Using the SDK with a stamper

#### This example demonstrates using a PasskeyStamer but you can use:

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
        environment: 'dev', // omit this to default to prod
    });

    // NOTE: use the correct stamper for your framework (native, browser, etc)
    // check corresponding libraries above
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
