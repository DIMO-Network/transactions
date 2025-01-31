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

    const kernelSignerConfig = ({
      rpcUrl: RPC_URL,
      bundlerUrl: BUNDLER_RPC,
      paymasterUrl: PAYMASTER_RPC,
      environment: 'dev', // omit to default to prod
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

### Actions

| Notes                                                                                                       | Method                                 |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Initialize signer with user account infos                                                                   | passkeyInit()                          |
| Prompt the user for their signature to open a wallet session, length of wallet session can be set in config | openSessionWithPasskey()               |
| Use credentials returned from DIMO Accounts api to open a wallet session for user                           | openSessionWithApiStamper()            |
| Get passkey client (this will require user to sign for all transactions)                                    | getPasskeyClient()                     |
| Return active API or wallet session client, if applicable, otherwise, return passkey client                 | getActiveClient()                      |
|                                                                                                             | mintVehicleWithDeviceDefinition()      |
|                                                                                                             | setVehiclePermissions()                |
|                                                                                                             | setVehiclePermissionsBulk()            |
|                                                                                                             | sendDIMOTokens()                       |
|                                                                                                             | claimAftermarketDevice()               |
|                                                                                                             | pairAftermarketDevice()                |
|                                                                                                             | claimAndPairAftermarketDevice()        |
|                                                                                                             | burnVehicle()                          |
|                                                                                                             | transferVehicleAndAftermarketDevices() |
|                                                                                                             | unpairAftermarketDevice()              |
|                                                                                                             | signTypedData()                        |
|                                                                                                             | signChallenge()                        |
|                                                                                                             | generateChallenge()                    |
|                                                                                                             | submitWeb3Challenge()                  |
|                                                                                                             | uploadSACDAgreement()                  |
|                                                                                                             | signSACDPermissionTemplate()           |
|                                                                                                             | signAndUploadSACDAgreement()           |
|                                                                                                             | getUserOperationReceipt()              |
|                                                                                                             | resetClient()                          |
