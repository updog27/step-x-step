import test from "node:test";
import assert from "node:assert/strict";
import {discoverTurnaroundCandidates} from "./turnaround-discovery.mjs";

test("alternate-path prefixes become turnarounds and retain their exact directed edges",()=>{
  const graph=new Map([
    ["S",[
      {to:"A",meters:50,wayId:1,edgeId:"short-a"},
      {to:"B",meters:25,wayId:2,edgeId:"alternate-b"}
    ]],
    ["A",[{to:"T",meters:50,wayId:1,edgeId:"short-t"}]],
    ["B",[{to:"X",meters:25,wayId:3,edgeId:"alternate-x"}]],
    ["X",[{to:"T",meters:55,wayId:4,edgeId:"alternate-finish"}]],
    ["T",[]]
  ]);
  // The shortest-tree distance to X is deliberately outside this input pool.
  const selected=discoverTurnaroundCandidates(graph,"S",[["T",100]],50,60);
  const alternate=selected.find(item=>item.candidate[0]==="X");
  assert.ok(alternate,"intermediate node on the Yen alternative should be discovered");
  assert.deepEqual(alternate.path.nodes,["S","B","X"]);
  assert.deepEqual(alternate.path.edges.map(edge=>edge.edgeId),["alternate-b","alternate-x"]);
  assert.deepEqual(alternate.path.edgeKeys,["alternate-b","alternate-x"]);
  assert.equal(alternate.path.distanceMeters,50);
});

test("turnaround discovery remains bounded and rejects invalid controls",()=>{
  const graph=new Map([
    ["S",[{to:"A",meters:10,wayId:1}]],
    ["A",[{to:"T",meters:10,wayId:1}]],
    ["T",[]]
  ]);
  assert.throws(()=>discoverTurnaroundCandidates(graph,"S",[["T",20]],10,0),RangeError);
  assert.throws(()=>discoverTurnaroundCandidates(graph,"S",[["T",20]],10,10,{maxTurnarounds:0}),RangeError);
  const selected=discoverTurnaroundCandidates(graph,"S",[["T",20]],10,15,{maxTurnarounds:1});
  assert.equal(selected.length,1);
});
