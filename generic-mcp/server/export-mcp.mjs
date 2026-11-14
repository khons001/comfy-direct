import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]);
const node=path.resolve(process.argv[3]);
const config={mcpServers:{comfy_direct:{command:node,args:[path.join(root,'bin.mjs'),'mcp'],env:{COMFY_DIRECT_CONFIG:path.join(root,'data/config.json'),COMFY_DIRECT_DATA_DIR:path.join(root,'data')}}}};
const target=path.join(root,'mcp-client.json');
fs.writeFileSync(target,JSON.stringify(config,null,2));
console.log(target);
