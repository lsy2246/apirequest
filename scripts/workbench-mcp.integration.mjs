// 仅针对显式指定的隔离本地测试后端；不连接默认预览实例，也不调用真实上游。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const base = process.env.MCP_TEST_BACKEND
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):317[12]$/.test(base ?? '')) throw new Error('Set MCP_TEST_BACKEND to the isolated loopback test backend on port 3171 or 3172')
const headers = { Origin: base.includes('localhost') ? 'http://localhost:3001' : 'http://127.0.0.1:3000', 'Content-Type': 'application/json', 'X-Workbench-Local': '1' }
let cookie = '', token = '', child, count = 0
const check = (value, message) => { assert.ok(value, message); count++ }
const http = async (path, body, extra = {}) => {
 const response = await fetch(`${base}/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
 return { response, data: await response.json().catch(() => ({})) }
}
try {
 const connected = await http('auth/local-session', {})
 check(connected.response.ok, 'local session established')
 cookie = connected.response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ')
 const enabled = await http('workbench-mcp/access', { enabled: true })
 check(enabled.response.ok && enabled.data.token, 'isolated MCP token created')
 token = enabled.data.token
 check((await http('workbench-mcp/tool', { name: 'workbench_help' })).response.status === 401, 'cookie cannot replace MCP token')
 check((await http('workbench-mcp/access', { enabled: true }, { Cookie: '', Authorization: `Bearer ${token}` })).response.status === 401, 'MCP token cannot administer access')
 check((await http('workbench-mcp/tool', { name: 'workbench_help' }, { Origin: 'https://untrusted.example', Authorization: `Bearer ${token}` })).response.status === 403, 'wrong origin rejected')
 child = spawn(process.execPath, [fileURLToPath(new URL('./workbench-mcp.mjs', import.meta.url))], { env: { ...process.env, APIREQUEST_BACKEND: base, APIREQUEST_MCP_TOKEN: token, APIREQUEST_ORIGIN: headers.Origin }, stdio: ['pipe', 'pipe', 'pipe'] })
 let buffer = '', sequence = 0
 const pending = new Map()
 child.stdout.setEncoding('utf8')
 child.stdout.on('data', data => { buffer += data; let end; while ((end = buffer.indexOf('\n')) >= 0) { const message = JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);pending.get(message.id)?.(message);pending.delete(message.id) } })
 const rpc = (method, params = {}) => new Promise((resolve,reject) => { const id=++sequence; const timer=setTimeout(()=>reject(new Error(`MCP timeout: ${method}`)),15000);pending.set(id,msg=>{clearTimeout(timer);msg.error?reject(new Error(msg.error.message)):resolve(msg.result)});child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method, params })+'\n') })
 const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name:'local-integration',version:'1' } })
 check(init.capabilities.tools && init.instructions.includes('cannot approve'), 'MCP initialization describes approval boundary')
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n')
 check((await rpc('tools/list')).tools.length === 5, 'self-describing MCP tool discovery')
 const call = async (name, args={}, error=false) => { const value=await rpc('tools/call',{name,arguments:args}); if (!error) check(!value.isError, `tool succeeded: ${name}`);return error?value:JSON.parse(value.content[0].text) }
 check((await call('workbench_help')).entities.length === 8, 'all configuration domains documented')
 check((await http('workbench-mcp/state')).data.approvalRequired === true, 'approval defaults to required')
 const propose = (entity, operation, data, id, key=randomUUID()) => call('workbench_propose_change',{entity,operation,data,id,idempotencyKey:key,reason:'本地隔离验收'})
 const decide = async (p,approve=true) => http(`workbench-mcp/proposals/${p.id}/decision`, {approve})
 const apply = async p => { const result=await decide(p);check(result.response.ok && result.data.status==='applied',`approved ${p.change.entity} ${p.change.operation}`);return result.data.result?.id }
 const get = (entity,id) => call('workbench_get',{entity,id})
 const baseline=(await call('workbench_list',{entity:'collection'})).items.length
 const proposal=await propose('collection','create',{title:'MCP 隔离验收',type:'REST'},undefined,'test-'+randomUUID())
 check((await call('workbench_list',{entity:'collection'})).items.length===baseline,'proposal does not mutate before approval')
 const duplicate=await call('workbench_propose_change',proposal.change)
 check(duplicate.id===proposal.id,'transport retry is idempotent')
 check((await http(`workbench-mcp/proposals/${proposal.id}/decision`,{approve:true},{Cookie:'',Authorization:`Bearer ${token}`})).response.status===401,'MCP token cannot approve')
 const collection=await apply(proposal)
 check((await decide(proposal)).response.status===409,'approval cannot replay')
 const request=await apply(await propose('request','create',{title:'本地 HTTP',collectionID:collection,type:'REST',request:{endpoint:'http://127.0.0.1:3188/api/echo',method:'POST',headers:[{key:'Authorization',value:'Bearer mcp-only-test-secret',active:true,description:''}],body:{contentType:'application/json',body:'{"check":true}'}}}))
 const retrieved=await get('request',request)
 check(!JSON.stringify(retrieved).includes('mcp-only-test-secret'),'queries redact existing authentication')
 const rejected=await propose('request','update',{title:'不应生效'},request)
 check((await decide(rejected,false)).data.status==='rejected','owner can reject')
 check((await get('request',request)).data.title==='本地 HTTP','rejection leaves data unchanged')
 const stale=await propose('request','update',{title:'旧提案'},request)
 await apply(await propose('request','update',{title:'新配置'},request))
 check((await decide(stale)).response.status===409,'stale preview cannot overwrite a newer configuration')
 const environment=await apply(await propose('environment','create',{name:'MCP 环境',variables:[{key:'baseUrl',currentValue:'http://127.0.0.1:3188',initialValue:'http://127.0.0.1:3188',secret:false},{key:'testSecret',currentValue:'mcp-env-secret-value',initialValue:'mcp-env-secret-value',secret:true}]}))
 check(!JSON.stringify(await get('environment',environment)).includes('mcp-env-secret-value'),'secret environment values are redacted')
 const automation=await apply(await propose('automation','create',{name:'MCP 自动化',collectionID:collection,environmentID:environment,config:{iterations:2,delay:50}}))
 const load=await apply(await propose('load_test','create',{name:'MCP 压测',requestID:request,config:{mode:'requests',concurrency:2,requests:20,durationSeconds:10,timeoutMs:1000}}))
 await apply(await propose('load_test','update',{config:{concurrency:3}},load))
 check((await get('load_test',load)).data.config.concurrency===3,'plan supports a nested partial update')
 const websocket=await apply(await propose('websocket','create',{name:'MCP WebSocket',url:'ws://127.0.0.1:3188',protocols:['echo']}))
 const mock=await apply(await propose('mock','create',{name:'MCP Test Mock',collectionID:collection,isPublic:false,isActive:false,delayInMs:10}))
 check((await get('mock',mock)).data.isActive===false,'inactive Mock creation uses actual server settings')
 const doc=await apply(await propose('documentation','create',{title:'MCP 文档',collectionID:collection,version:'CURRENT',autoSync:true,metadata:{}}))
 await apply(await propose('documentation','update',{title:'MCP 文档更新'},doc))
 check((await get('documentation',doc)).data.title==='MCP 文档更新','documentation update is persisted')
 // 覆盖关闭审批后的策略边界、已排队变更和幂等重试。
 const queued = await propose('request','update',{title:'等待手工审批'},request)
 const policyPath = 'workbench-mcp/approval-policy'
 check((await http(policyPath,{required:false},{Cookie:'',Authorization:`Bearer ${token}`})).response.status===401,'MCP token cannot change the approval policy')
 check((await http(policyPath,{required:false})).data.approvalRequired===false,'owner can allow automatic changes')
 check((await call('workbench_change_status',{proposalID:queued.id})).status==='pending','existing proposals remain pending')
 const autoKey = randomUUID()
 const autoInput = {name:'MCP 自动生效',url:'ws://127.0.0.1:3188'}
 const auto = await propose('websocket','create',autoInput,undefined,autoKey)
 check(auto.status==='applied' && auto.automatic===true,'ordinary changes apply and are recorded')
 const retry = await propose('websocket','create',autoInput,undefined,autoKey)
 check(retry.id===auto.id && retry.result.id===auto.result.id,'automatic writes are idempotent')
 const directUpdate = await propose('request','update',{title:'直接修改'},request)
 check(directUpdate.status==='applied' && (await get('request',request)).data.title==='直接修改','ordinary updates apply immediately')
 const directDoc = await propose('documentation','update',{title:'直接修改的文档'},doc)
 check(directDoc.status==='applied' && directDoc.automatic===true && (await get('documentation',doc)).data.title==='直接修改的文档','documentation changes apply immediately when approval is off')
 const deleteKey = randomUUID()
 const directDelete = await propose('websocket','delete',undefined,auto.result.id,deleteKey)
 check(directDelete.status==='applied' && directDelete.automatic===true,'deletions apply immediately when approval is off')
 const deleteRetry = await propose('websocket','delete',undefined,auto.result.id,deleteKey)
 check(deleteRetry.id===directDelete.id && deleteRetry.status==='applied','automatic deletion retries are idempotent')
 await decide(queued,false)
 check((await http(policyPath,{required:true})).data.approvalRequired===true,'owner can restore approval')
 const gqlCollection=await apply(await propose('collection','create',{title:'MCP GraphQL',type:'GQL'}))
 const gql=await apply(await propose('request','create',{title:'GraphQL 查询',collectionID:gqlCollection,type:'GQL',request:{url:'http://127.0.0.1:3188/graphql',query:'{ hello }',variables:'{}'}}))
 check((await get('request',gql)).data.type==='GQL','GraphQL request is supported')
 const invalid=await call('workbench_propose_change',{entity:'load_test',operation:'update',id:load,data:{config:{concurrency:999}},reason:'非法并发',idempotencyKey:randomUUID()},true)
 check(invalid.isError,'invalid concurrency is rejected before approval')
 const forged=await call('workbench_propose_change',{entity:'request',operation:'update',id:request,data:{userUid:'other'},reason:'伪造所有权',idempotencyKey:randomUUID()},true)
 check(forged.isError,'ownership fields are not writable')
 for(const [entity,id] of [['documentation',doc],['mock',mock],['automation',automation],['load_test',load],['websocket',websocket],['environment',environment],['request',gql],['collection',gqlCollection],['request',request],['collection',collection]]) await apply(await propose(entity,'delete',undefined,id))
 check((await call('workbench_list',{entity:'collection'})).items.length===baseline,'CRUD cleanup preserves preexisting collections')
 const pendingProposal=await propose('environment','create',{name:'撤销后不应执行'})
 await http('workbench-mcp/access',{enabled:false})
 check((await decide(pendingProposal)).response.status===409,'revoking access invalidates pending proposals')
 check((await call('workbench_help',{},true)).isError,'revoked token is rejected')
 console.log(JSON.stringify({status:'passed',assertions:count,transport:'MCP stdio 2025-11-25',domains:8,backend:base},null,2))
} finally {
 if (cookie) await http('workbench-mcp/approval-policy',{required:true}).catch(()=>{})
 if (cookie) await http('workbench-mcp/access',{enabled:false}).catch(()=>{})
 if(child && child.exitCode===null) { child.kill('SIGTERM');await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve()},1500).unref()}) }
}
