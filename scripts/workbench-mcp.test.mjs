import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHandler, tools } from './workbench-mcp.mjs'
const env={APIREQUEST_MCP_TOKEN:'unit-test-only',APIREQUEST_BACKEND:'http://127.0.0.1:3171',APIREQUEST_ORIGIN:'http://127.0.0.1:3000'}
const initialize=h=>h({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}})
test('初始化、能力发现和未知方法',async()=>{
 const h=createHandler(env)
 assert.equal((await h({jsonrpc:'2.0',id:1,method:'tools/list'})).error.code,-32002)
 assert.equal((await initialize(h)).result.protocolVersion,'2025-11-25')
 assert.equal((await h({jsonrpc:'2.0',id:2,method:'tools/list'})).result.tools.length,5)
 assert.equal((await h({jsonrpc:'2.0',id:3,method:'does/not/exist'})).error.code,-32601)
 assert.equal(await h({jsonrpc:'2.0',method:'notifications/initialized'}),null)
 assert.ok(!tools.some(t=>/approve|execute|run/.test(t.name)))
})
test('只向配置的回环后端发送令牌，禁止重定向',async()=>{
 let calls=0
 const h=createHandler(env,async(url,opts)=>{calls++;assert.equal(url.hostname,'127.0.0.1');assert.equal(opts.headers.Authorization,'Bearer unit-test-only');assert.equal(opts.redirect,'error');return {ok:true,json:async()=>({items:[]})}})
 await initialize(h)
 const result=await h({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'workbench_list',arguments:{entity:'collection'}}})
 assert.equal(result.result.isError,false);assert.equal(calls,1)
})
test('非本机地址和缺少令牌不会发出网络请求',async()=>{
 for(const config of [{...env,APIREQUEST_BACKEND:'https://untrusted.example'}, {...env,APIREQUEST_BACKEND:'http://user:password@127.0.0.1:3171'}, {...env,APIREQUEST_MCP_TOKEN:''}]){
 const h=createHandler(config,async()=>{throw new Error('Must not send')});await initialize(h)
 const result=await h({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'workbench_help'}})
 assert.equal(result.result.isError,true)
 assert.ok(!result.result.content[0].text.includes('unit-test-only'))
 }
})
test('远端失败作为工具错误返回，不伪装成功',async()=>{
 const h=createHandler(env,async()=>({ok:false,status:409,json:async()=>({message:'Conflict'})}));await initialize(h)
 const result=await h({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'workbench_help'}})
 assert.equal(result.result.isError,true);assert.equal(result.result.content[0].text,'Conflict')
})
