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

    const account = privateKeyToAccount(pk as `0x${string}`);

    const signer = new AccountSigner({
        rpcURL: RPC_URL,
        account: account,
        environment: 'dev',
    });

    const txHash = signer.sendDIMOTokens({
        recipient: '0x_recipient_addr_here',
        amount: BigInt(10),
    });

```

Using the SDK with a passkey signer:

```js
    import { KernelSigner, newKernelConfig, sacdPermissionValue } from '@dimo-network/transactions';

    const kernelSignerConfig = newKernelConfig(
        RPC_URL,
        BUNDLER_RPC,
        PAYMASTER_RPC,
    );

    const signer = new KernelSigner(kernelSignerConfig);

    await signer.passkeyInit(
        subOrganizationId,
        walletAddress as `0x${string}`,
        'https://api.turnkey.com',
        RPID,
    );

    const perms = sacdPermissionValue({
        ALLTIME_LOCATION: true,
    });

    const {success, reason, receipt} = await signer.setVehiclePermissions({
        tokenId: tokenId,
        grantee: grantee,
        permissions: BigInt(perms),
        expiration: expiration,
        source: source,
      });
```

### Contributing:

To build the `.tgz` file, run the following:

- npm run build
- npm pack
