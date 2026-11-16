import test from "node:test";
import assert from "node:assert/strict";
import {handleRouteRequest} from "./routes.mjs";

const post=(body)=>({httpMethod:"POST",headers:{"x-forwarded-for":"test-client"},body:JSON.stringify(body)});
test("rejects unsupported methods and invalid request fields",async()=>{
 assert.equal((await handleRouteRequest({httpMethod:"GET"})).statusCode,405);
 assert.equal((await handleRouteRequest(post({lat:91,lon:0,miles:1}))).statusCode,400);
 assert.equal((await handleRouteRequest(post({lat:27,lon:-82,miles:0}))).statusCode,400);
 assert.equal((await handleRouteRequest(post({lat:27,lon:-82,miles:1,routeType:"loop"}))).statusCode,400);
});
test("does not publish route geometry when origin access is unverified",async()=>{
 const nodes=new Map([["n",{id:"n",lat:27,lon:-82,tags:{}}]]);
 const fakeMap={nodes,ways:[],graph:new Map([["n",[]]]),cacheHit:true};
 const response=await handleRouteRequest(post({lat:27,lon:-82,miles:1}),{
  loadOsmGraph:async()=>fakeMap,
  now:()=>Date.now()+2000
 });
 assert.ok([200,200].includes(response.statusCode));
 const body=JSON.parse(response.body);
 if(body.routes)for(const route of body.routes)assert.equal(route.geometry,null);
});

import {loadOsmGraph} from "./routes.mjs";

test("loads and caches normalized OSM pedestrian map data",async()=>{
 const elements=[
  {type:"node",id:910001,lat:27.1,lon:-82.1,tags:{}},
  {type:"node",id:910002,lat:27.101,lon:-82.1,tags:{}},
  {type:"way",id:920001,nodes:[910001,910002],tags:{highway:"footway"}}
 ];
 let calls=0;
 const fakeFetch=async()=>{calls++;return {ok:true,status:200,json:async()=>({elements})};};
 const first=await loadOsmGraph(27.1,-82.1,600,fakeFetch,100000);
 const second=await loadOsmGraph(27.1,-82.1,600,fakeFetch,100001);
 assert.equal(calls,1);
 assert.equal(first.nodes.size,2);
 assert.equal(first.ways.length,1);
 assert.ok(first.graph.size>0);
 assert.equal(second.cacheHit,true);
});
test("maps provider rate limiting into a stable error code",async()=>{
 await assert.rejects(
  loadOsmGraph(27.2,-82.2,600,async()=>({ok:false,status:429}),200000),
  error=>error.code==="PROVIDER_RATE_LIMITED"
 );
});

test("rejects partial Overpass responses even when elements are present",async()=>{
 const partial={elements:[
  {type:"node",id:930001,lat:27.31,lon:-82.31,tags:{}},
  {type:"way",id:930002,nodes:[930001,930003],tags:{highway:"footway"}}
 ],remark:"runtime error: Query timed out in 'query'"};
 await assert.rejects(
  loadOsmGraph(27.31,-82.31,610,async()=>({ok:true,status:200,json:async()=>partial}),300000),
  error=>error.code==="MAP_DATA_INCOMPLETE"&&/timed out/.test(error.message)
 );
});

test("fails over to a second Overpass provider after a rate limit",async()=>{
 const original=process.env.OSM_OVERPASS_URL;
 delete process.env.OSM_OVERPASS_URL;
 const elements=[
  {type:"node",id:940001,lat:27.41,lon:-82.41,tags:{}},
  {type:"node",id:940002,lat:27.411,lon:-82.41,tags:{}},
  {type:"way",id:940003,nodes:[940001,940002],tags:{highway:"footway"}}
 ];
 const calls=[];
 const fakeFetch=async(url,options)=>{
  calls.push({url,headers:options.headers});
  if(calls.length===1)return {ok:false,status:429};
  return {ok:true,status:200,json:async()=>({elements})};
 };
 try{
  const result=await loadOsmGraph(27.41,-82.41,620,fakeFetch,400000);
  assert.equal(calls.length,2);
  assert.ok(calls[0].headers["user-agent"].includes("github.com/Updog27/step-x-step"));
  assert.equal(result.provider,"overpass.kumi.systems");
  assert.equal(result.nodes.size,2);
 }finally{
  if(original===undefined)delete process.env.OSM_OVERPASS_URL;else process.env.OSM_OVERPASS_URL=original;
 }
});
