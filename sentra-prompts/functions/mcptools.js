import SentraMcpSDK from '../../sentra-mcp/src/sdk/index.js';

export async function getMcpTools() {
    try {
        const sdk = new SentraMcpSDK();
        if (typeof sdk.init === 'function') {
            await sdk.init();
        }
        const result = await sdk.exportTools({ format: 'md' })
        return result?.content;
    } catch (err) {
        return `MCP  : ${err?.message || String(err)}`;
    }
}