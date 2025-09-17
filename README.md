# DIMO Transactions SDK

The DIMO transactions SDK was created to help developers build on DIMO.

## Installation

Use [npm](https://www.npmjs.com/package/@dimo-network/transactions):

```bash
npm install @dimo-network/transactions
```

## How to Use the SDK

If you're a developer interested in using the DIMO Transactions SDK for **multi-user** or **corporate** purposes, where you will want to prompt **DIMO users** to take actions on their own accounts, the **Kernel Client** is for you. Kernel Clients are intended to work with **DIMOs Global Accounts**, security-improved wallets that reduce fees for users, enable account recorvery options, and create a more flexible ecosystem for developers to build on DIMO. See below for an example:

#### Setting Vehicle Permissions with a Kernel Signer

##### This example demonstrates using a PasskeyStamer but you can use:

- WebauthnStamper (@turnkey/webauthn-stamper)
- IframeStamper (@turnkey/iframe-stamper)
- ApiKeyStamper (@turnkey/api-key-stamper)

```js
    import { PasskeyStamper } from "@turnkey/react-native-passkey-stamper";
    import { KernelSigner, newKernelConfig, sacdPermissionValue } from '@dimo-network/transactions';

    export const kernelSignerConfig = newKernelConfig({
      rpcUrl: RPC_URL,
      bundlerUrl: BUNDLER_RPC,
      paymasterUrl: PAYMASTER_RPC,
      environment: BACKEND_ENV,
      useWalletSession: true,
      clientId: AUTH_CLIENT_ID,
      domain: AUTH_ISSUER,
      redirectUri: AUTH_ISSUER,
      defaultPermissions: sacdPermissionValue({
        NONLOCATION_TELEMETRY: true,
        COMMANDS: true,
        CURRENT_LOCATION: true,
        ALLTIME_LOCATION: true,
        CREDENTIALS: true,
        STREAMS: true,
      }),
    });

    // NOTE: use the correct stamper for your framework
    const stamper = new PasskeyStamper({
        rpId: RPID,
    });

    const kernelSigner = new KernelSigner(kernelSignerConfig);
    await kernelSigner.init(suborganizationId, stamper);

    const permissions = kernelSigner.getDefaultPermissionValue();

    const ipfsRes = await kernelSigner.signAndUploadSACDAgreement({
        driverID: grantee,
        appID: DIMO_APP_ID,
        appName: APP_NAME,
        expiration: expiration,
        permissions: permissions,
        tokenId: tokenId,
        grantee: grantee,
        attachments: [],
        grantor: kernelSigner.smartContractAddress!,
      });

      if (!ipfsRes.success) {
        throw new Error(
          `Unable to sign and upload SACD agreement: ${ipfsRes.error}`,
        );
      }

      const result = await kernelSigner.setVehiclePermissions({
        tokenId,
        grantee,
        permissions,
        expiration,
        source: `ipfs://${ipfsRes.data?.cid}`,
      });

```

### Connecting the Signer

Connecting a signer is the first step to working with the DIMO transactions SDK. If you want to take actions directly with a wallet, you have the option to create a signer via private key. However, to build apps on DIMO, we can prompt the user to initialize with

A few key terms to keep in mind:

- A session is used as shorthand to indicate a wallet or api session. This means that the user signs an agreement allowing them to take on chain actions for a period of X minutes (configurable in the kernel config). When a session is open, any transactions taken using this session will not require a signature.

- When creating a signer with a passkey stamper or API stamper, you can move flexibly between API sessions (which require no signature) or a standard passkey signer (which will require a signature for all transactions). When a wallet session is open, you have the option of calling `getPasskeyClient()` to exclude a specific transaction from the wallet session. An example of this might be: use a wallet session for all transactions except those which transfer funds out of the user wallet.

| Method                      | Notes                                                                                                       | Returns             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------- |
| resetClient()               | Clears all state, this can be used to force user log-out                                                    | -                   |
| hasActiveSession()          | Returns true if the user has an active wallet session                                                       | boolean             |
| getActiveClient()           | After initialization, will create active session, if needed, and return signer                              | KernelAccountClient |
| getPasskeyClient()          | Returns passkey client regardless of active session; user will be required to sign any transactions         | KernelAccountClient |
| init()                      | Creates a session with the subOrganizationID and stamper                                                    | -                   |
| passkeyInit()               | Creates a passkey signer with the subOrganizationID, wallet address and stamper                             | -                   |
| passkeyToSession()          | Opens a wallet session using passkey signer                                                                 | -                   |
| openSessionWithPasskey()    | Prompt the user for their signature to open a wallet session, length of wallet session can be set in config | -                   |
| openSessionWithApiStamper() | Use credentials returned from DIMO Accounts api to open a wallet session for user                           | -                   |
| privateKeyInit()            | Creates a signer via private key; not compatible with sessions                                              | -                   |

### Actions

- mintVehicleWithDeviceDefinition
- setVehiclePermissions
- setVehiclePermissionsBulk
- sendDIMOTokens
- claimAftermarketDevice
- pairAftermarketDevice
- pairAftermarketDeviceWithAdSig
- claimAndPairAftermarketDevice
- burnVehicle
- transferVehicleAndAftermarketDevices
- unpairAftermarketDevice
- addStake
- withdrawStake
- upgradeStake
- attacheVehicleToStake
- detachVehicleFromStake

### Helper Methods

- claimAftermarketDeviceTypeHash
- signTypedData
- signChallenge
- generateChallenge
- submitWeb3Challenge
- getJWT
- uploadSACDAgreement
- signSACDPermissionTemplate
- signAndUploadSACDAgreement
- getUserOperationReceipt
- isDeployed
- deriveKernelAddress
- executeTransaction
- \_sendUserOperation

## For SDK Maintainers

To update the version of the DIMO Transactions SDK, follow these steps:

1. Update the version number in `package.json`:

```json
{
  "name": "@dimo-network/transactions",
  "version": "x.y.z",  // Change this to the new version
  ...
}
```

2. Run the prebuild script to update the version in the codebase and `package-lock.json`:

```bash
npm run prebuild
```

3. Build the package:

```bash
npm run build
```

4. Create a local package for testing (optional):

```bash
npm pack
```

5. Publish the new version to npm:

```bash
npm publish --tag latest
```

### Testing before publishing

[yalc](https://www.npmjs.com/package/yalc) is a better and recommended package to test the sdk integration in other projects instead of `npm link`