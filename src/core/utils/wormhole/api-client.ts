// WormholeScan API Client - simple wrapper for making requests to the WormholeScan API
export class WormholeScanAPI {
  private baseURL: string;

  constructor(isTestnet: boolean = false) {
    this.baseURL = isTestnet 
      ? 'https://api.testnet.wormholescan.io/api/v1'
      : 'https://api.wormholescan.io/api/v1';
  }

  async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    try {
      const url = new URL(`${this.baseURL}${endpoint}`);
      
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            url.searchParams.append(key, String(value));
          }
        });
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} - ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`API request failed: ${error.message}`);
      }
      throw new Error(`Unexpected error: ${error}`);
    }
  }

  async getTokenTransfers(params: {
    tokenAddress?: string;
    fromChain?: number;
    toChain?: number;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  } = {}) {
    return this.get('/native-token-transfer', params);
  }
}

export const wormholeScanAPI = new WormholeScanAPI();
export const wormholeScanTestnetAPI = new WormholeScanAPI(true);
