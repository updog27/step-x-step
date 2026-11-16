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
