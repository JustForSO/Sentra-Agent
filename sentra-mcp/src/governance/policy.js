import { config } from '../config/index.js';

export const Governance = {
  isAllowed(tool, options = {}) {
    const scope = tool.scope || config.governance.defaultScope;
    const tenant = tool.tenant || config.governance.defaultTenantId;
    const reqTenant = options.tenantId || config.governance.defaultTenantId;
    // Simple tenant isolation: require match
    if (tenant && reqTenant && tenant !== reqTenant && tenant !== 'any') {
      return { allowed: false, reason: `Tenant mismatch: required=${tenant}, got=${reqTenant}` };
    }
    // Scope policy can be expanded; allow all by default
    return { allowed: true };
  }
};

export default Governance;
