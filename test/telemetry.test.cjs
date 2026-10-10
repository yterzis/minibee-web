const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.match(/<script id="telemetry-app">([\s\S]*?)<\/script>/)[1];
const UUID = {
  nus:'6e400001-b5a3-f393-e0a9-e50e24dcca9e', tx:'6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  control:'d4cf0001-9b9d-4bfd-8f7f-40c6989d3ea9', telemetry:'d4cf0003-9b9d-4bfd-8f7f-40c6989d3ea9'
};
const sentence = (temp='42', origin='ntc', esc='33') =>
  `$XCTOD,80,79,54.250,4.2,65,2000,100,${temp},${origin},4200,78,${esc},DISARMED,29,3500,4125\r\n`;
function view(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, value) { for (const fn of this.listeners.get(name) || []) fn({target:{value}}); }
}
function harness(options={}) {
  const nodes = new Map(), intervals = [], requested = [];
  let now = 1000, writes = 0, selections = 0, chooser;
  for (const id of [...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1])) {
    nodes.set(id,{textContent:'',innerHTML:'',disabled:false});
  }
  for (let i=0;i<14;i++) nodes.set('v'+i,{textContent:'—'});
  const chars = Object.fromEntries([UUID.tx, UUID.telemetry].map(id=>[id,new Events()]));
  for (const ch of Object.values(chars)) {
    ch.startNotifications = async()=>{
      if (options.noBinary && ch === chars[UUID.telemetry]) throw Error('Notifications unavailable');
      return ch;
    };
    ch.writeValue = ch.writeValueWithResponse = async()=>{ writes++; throw Error('Unexpected write'); };
  }
  const device = new Events();
  const server = {getPrimaryService: async id=>{
    if (id === UUID.control && options.oldFirmware) throw Error('Service not found');
    return {getCharacteristic: async key=>{
      requested.push(key); if (!chars[key]) throw Error('Unexpected characteristic'); return chars[key];
    }};
  }};
  device.gatt = {connected:false,connect:async()=>{device.gatt.connected=true;return server;},disconnect:()=>{
    device.gatt.connected=false;device.emit('gattserverdisconnected');
  }};
  const context = vm.createContext({
    document:{getElementById:id=>{assert.ok(nodes.has(id),`Missing DOM element ${id}`);return nodes.get(id);}},
    navigator:{bluetooth:{requestDevice:async args=>{selections++;chooser=args;return device;}}},
    TextDecoder,Uint8Array,DataView,Date:{now:()=>now},setInterval:fn=>intervals.push(fn)
  });
  vm.runInContext(source,context);
  const api = vm.runInContext('({connect,getSession:()=>session})',context);
  return {api,nodes,requested,device,chars,context,
    get writes(){return writes;},get selections(){return selections;},get chooser(){return chooser;},get session(){return api.getSession();},
    csv:text=>chars[UUID.tx].emit('characteristicvaluechanged',view(new TextEncoder().encode(text))),
    binary:({origin=2,valid=3,flags=0,temp=42500,version=1,length=69}={})=>{
      const bytes=new Uint8Array(length),v=view(bytes);
      bytes[0]=version;bytes[1]=flags;bytes[5]=valid<<4;bytes[6]=origin;
      if(length>=32)v.setInt32(28,temp,true);
      chars[UUID.telemetry].emit('characteristicvaluechanged',v);
    },tick:ms=>{now+=ms;intervals.forEach(fn=>fn());}
  };
}
test('page has telemetry cards without PIN, configuration or authentication',async()=>{
  assert.doesNotMatch(html,/<input|<form|id="use-ntc"|id="config-status"/);
  const h=harness();await h.api.connect();h.csv(sentence());h.binary();
  assert.deepEqual(h.requested,[UUID.tx,UUID.telemetry]);assert.equal(h.writes,0);
  assert.deepEqual(Array.from(h.chooser.optionalServices),[UUID.control]);
});
test('CAN motor value is hidden while the independent ESC value is preserved',async()=>{
  const h=harness();await h.api.connect();h.csv(sentence('31','can'));
  assert.equal(h.nodes.get('v8').textContent,'—');assert.equal(h.nodes.get('v9').textContent,'33');
  assert.match(h.nodes.get('temperature-status').textContent,/CAN/);assert.equal(h.writes,0);
});
test('valid NTC, zero and missing readings display correctly',async()=>{
  const h=harness();await h.api.connect();
  h.csv(sentence());assert.equal(h.nodes.get('v8').textContent,'42');
  h.csv(sentence('0'));assert.equal(h.nodes.get('v8').textContent,'0');
  h.csv(sentence(''));assert.equal(h.nodes.get('v8').textContent,'—');
  assert.match(h.nodes.get('temperature-status').textContent,/indisponível/);
});
test('every split point waits for the newline, including the final cell field',async()=>{
  const full=sentence();
  for(let i=1;i<full.length;i++){
    const h=harness();await h.api.connect();
    h.csv(full.slice(0,i));assert.equal(h.nodes.get('v13').textContent,'—',`early split ${i}`);
    h.csv(full.slice(i));assert.equal(h.nodes.get('v13').textContent,'4125',`split ${i}`);
    assert.equal(h.nodes.get('v8').textContent,'42');assert.equal(h.writes,0);
  }
});
test('multiple sentences, noise and overflow recover without shifting fields',async()=>{
  const h=harness();await h.api.connect();
  h.csv('noise'+sentence()+sentence('43','ntc','34'));
  assert.equal(h.nodes.get('v8').textContent,'43');assert.equal(h.nodes.get('v9').textContent,'34');
  h.csv('x'.repeat(3000));h.csv(sentence('44'));
  assert.equal(h.nodes.get('v8').textContent,'44');assert.equal(h.nodes.get('v13').textContent,'4125');
});
test('binary validity, source, units and suspended protection are honored',async()=>{
  const h=harness();await h.api.connect();h.csv(sentence());h.binary();
  assert.equal(h.nodes.get('v8').textContent,'42');
  h.binary({valid:2,flags:0x40});assert.equal(h.nodes.get('v8').textContent,'—');
  assert.match(h.nodes.get('temperature-status').textContent,/suspensa/);
  h.binary({origin:1});assert.equal(h.nodes.get('v8').textContent,'—');
  h.binary({temp:0});assert.equal(h.nodes.get('v8').textContent,'0');
  assert.equal(h.writes,0);
});
test('unsupported or short binary packets do not replace a valid CSV reading',async()=>{
  const h=harness();await h.api.connect();h.csv(sentence());
  h.binary({version:2});h.binary({length:16});assert.equal(h.nodes.get('v8').textContent,'42');
});
test('firmware without binary service remains read-only and displays NUS data',async()=>{
  for(const options of [{oldFirmware:true},{noBinary:true}]){
    const h=harness(options);await h.api.connect();h.csv(sentence());
    assert.equal(h.nodes.get('v8').textContent,'42');assert.equal(h.nodes.get('v13').textContent,'4125');
    assert.equal(h.writes,0);assert.match(h.nodes.get('status').textContent,/Recebendo/);
  }
});
test('stale readings are cleared and binary health cannot be replaced by CSV',async()=>{
  const h=harness();await h.api.connect();h.csv(sentence());h.binary();h.tick(6000);
  assert.equal(h.nodes.get('v8').textContent,'—');assert.equal(h.nodes.get('v9').textContent,'—');
  h.csv(sentence());assert.equal(h.nodes.get('v8').textContent,'—');
  h.binary();assert.equal(h.nodes.get('v8').textContent,'42');
});
test('disconnect/reconnect clears partial frames and old values without duplicate listeners',async()=>{
  const h=harness();await h.api.connect();h.csv(sentence());h.csv('$XCTOD,80');
  const old=h.session;h.device.gatt.disconnect();h.tick(6000);
  assert.equal(h.nodes.get('status').textContent,'Desconectado');assert.equal(h.nodes.get('v8').textContent,'—');
  await h.api.connect();assert.notEqual(h.session,old);h.csv('remaining\r\n');
  assert.equal(h.nodes.get('v8').textContent,'—');assert.equal(h.session.buffer,'');
  assert.equal(h.chars[UUID.tx].listeners.get('characteristicvaluechanged').size,1);
  h.csv(sentence());assert.equal(h.nodes.get('v8').textContent,'42');assert.equal(h.writes,0);
});
test('repeated connect clicks reuse the active session',async()=>{
  const h=harness();await Promise.all([h.api.connect(),h.api.connect()]);await h.api.connect();
  assert.equal(h.selections,1);assert.equal(h.nodes.get('connect').disabled,true);assert.equal(h.writes,0);
});
