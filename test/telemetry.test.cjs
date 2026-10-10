const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const UUID = {
  nus:'6e400001-b5a3-f393-e0a9-e50e24dcca9e', tx:'6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  control:'d4cf0001-9b9d-4bfd-8f7f-40c6989d3ea9', info:'d4cf0002-9b9d-4bfd-8f7f-40c6989d3ea9',
  telemetry:'d4cf0003-9b9d-4bfd-8f7f-40c6989d3ea9', cmd:'d4cf0004-9b9d-4bfd-8f7f-40c6989d3ea9',
  rsp:'d4cf0005-9b9d-4bfd-8f7f-40c6989d3ea9'
};
const sentence = (temp='42', origin='ntc', state='DISARMED') =>
  `$XCTOD,80,79,54.250,4.2,65,2000,100,${temp},${origin},4200,78,33,${state},29,3500,4125\r\n`;
function view(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, value) { for (const fn of this.listeners.get(name) || []) fn({target:{value}}); }
}
function harness(options={}) {
  const nodes = new Map(), timeouts = new Map(), intervals = [];
  let now = 1000, timerId = 0, auth = false, chooser;
  const writes = [], thermal = new Uint8Array(17);
  const thermalView = view(thermal);
  [60000,90000,70000,100000].forEach((n,i)=>thermalView.setInt32(i*4,n,true));
  thermal[16] = options.source || 0;
  const before = thermal.slice();
  const chars = Object.fromEntries(Object.values(UUID).map(id=>[id,new Events()]));
  for (const ch of Object.values(chars)) ch.startNotifications = async()=>ch;
  chars[UUID.info].readValue = async()=>view(Uint8Array.of(options.version || 1,3,options.noCapability ? 0 : 4,0));
  chars[UUID.cmd].writeValueWithResponse = async frame => {
    frame = Uint8Array.from(frame); writes.push(frame);
    const [op,seq] = frame;
    if (options.silentOp === op) return;
    let status = 0, payload = new Uint8Array();
    if (op === 1) { auth = !options.badPin; status = auth ? 0 : 1; }
    if (op === 16) payload = options.shortConfig ? thermal.slice(0,16) : thermal.slice();
    if (op === 17) {
      status = options.refuseSet ? 4 : auth ? 0 : 1;
      if (!status && !options.ignoreSet) thermal.set(frame.slice(4));
    }
    if (options.beforeReply) options.beforeReply(op);
    const response = Uint8Array.from([op,seq,status,payload.length,...payload]);
    chars[UUID.rsp].emit('characteristicvaluechanged', view(response));
    if (options.ack) await options.ack(op);
  };
  const device = new Events();
  const server = {getPrimaryService: async id=>{
    if (id === UUID.control && options.oldFirmware) throw Error('Service not found');
    return {getCharacteristic: async key=>chars[key]};
  }};
  device.gatt = {connected:false,connect:async()=>{device.gatt.connected=true;return server;},disconnect:()=>{
    device.gatt.connected=false;device.emit('gattserverdisconnected');
  }};
  const context = vm.createContext({
    document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',value:'',disabled:false});return nodes.get(id);}},
    navigator:{bluetooth:{requestDevice:async args=>{chooser=args;return device;}}},
    TextDecoder,TextEncoder,Uint8Array,DataView,Date:{now:()=>now},
    setInterval:fn=>intervals.push(fn),setTimeout:fn=>{timeouts.set(++timerId,fn);return timerId;},
    clearTimeout:id=>timeouts.delete(id)
  });
  vm.runInContext(source,context);
  for (const id of ['pin', ...Array.from({length:14}, (_,i)=>'v'+i)]) {
    if (!nodes.has(id)) nodes.set(id,{textContent:id === 'pin' ? '' : '—',innerHTML:'',value:'',disabled:false});
  }
  const api = vm.runInContext('({connect,useNtc,request,onResponse,getSession:()=>session})',context);
  return {api,nodes,writes,thermal,before,device,chars,context,
    get chooser(){return chooser;}, get session(){return api.getSession();},
    csv:text=>chars[UUID.tx].emit('characteristicvaluechanged',view(new TextEncoder().encode(text))),
    binary:({origin=2,valid=3,flags=0,temp=42500,version=1}={})=>{
      const bytes=new Uint8Array(69),v=view(bytes);
      bytes[0]=version;bytes[1]=flags;bytes[5]=valid<<4;bytes[6]=origin;v.setInt32(28,temp,true);
      chars[UUID.telemetry].emit('characteristicvaluechanged',v);
    },
    tick:ms=>{now+=ms;intervals.forEach(fn=>fn());},
    timeout:()=>{for(const [id,fn]of [...timeouts]){timeouts.delete(id);fn();}},
    apply:async()=>{nodes.get('pin').value='1234';await api.useNtc({preventDefault(){}});}
  };
}
test('connection requests control permission and performs only CFG_GET',async()=>{
  const h=harness();await h.api.connect();
  assert.deepEqual(Array.from(h.chooser.optionalServices),[UUID.control]);
  assert.deepEqual(h.writes.map(x=>x[0]),[16]);assert.equal(h.nodes.get('use-ntc').disabled,true);
  assert.match(h.nodes.get('config-status').textContent,/CAN/);
});
test('CAN motor temperature is hidden while ESC stays at 33',async()=>{
  const h=harness();await h.api.connect();h.csv(sentence('31','can'));
  assert.equal(h.nodes.get('v8').textContent,'—');assert.equal(h.nodes.get('v9').textContent,'33');
  assert.match(h.nodes.get('temperature-status').textContent,/CAN/);
});
test('valid NTC includes zero; empty NTC is unavailable',async()=>{
  const h=harness({oldFirmware:true});await h.api.connect();
  h.csv(sentence('0'));assert.equal(h.nodes.get('v8').textContent,'0');
  h.csv(sentence(''));assert.equal(h.nodes.get('v8').textContent,'—');
  assert.match(h.nodes.get('temperature-status').textContent,/indisponível/);
});
test('every split point waits for a complete sentence, including last cell field',async()=>{
  const full=sentence();
  for(let i=1;i<full.length;i++){
    const h=harness({oldFirmware:true});await h.api.connect();
    h.csv(full.slice(0,i));assert.equal(h.nodes.get('v13').textContent,'—',`early split ${i}`);
    h.csv(full.slice(i));assert.equal(h.nodes.get('v13').textContent,'4125',`split ${i}`);
    assert.equal(h.nodes.get('v8').textContent,'42');
  }
});
test('binary validity, source, units and protection suspension are honored',async()=>{
  const h=harness();await h.api.connect();h.csv(sentence());h.binary();
  assert.equal(h.nodes.get('v8').textContent,'42.5');
  h.binary({valid:2,flags:0x40});assert.equal(h.nodes.get('v8').textContent,'—');
  assert.match(h.nodes.get('temperature-status').textContent,/suspensa/);
  h.binary({origin:1});assert.equal(h.nodes.get('v8').textContent,'—');
  h.binary({temp:0});assert.equal(h.nodes.get('v8').textContent,'0');
});
test('apply authenticates, reads fresh limits, sets only NTC and verifies readback',async()=>{
  const h=harness();await h.api.connect();h.csv(sentence('31','can'));await h.apply();
  assert.deepEqual(h.writes.map(x=>x[0]),[16,1,16,17,16]);
  const set=h.writes.find(x=>x[0]===17);
  assert.deepEqual(Array.from(set.slice(0,4)),[17,4,18,1]);
  assert.deepEqual(set.slice(4,20),h.before.slice(0,16));assert.equal(set[20],1);
  assert.equal(h.thermal[16],1);assert.equal(h.nodes.get('pin').value,'');
  assert.match(h.nodes.get('config-status').textContent,/confirmado/);
  assert.equal(h.nodes.get('v8').textContent,'—'); // Configuration does not fabricate a reading.
  h.binary();assert.equal(h.nodes.get('v8').textContent,'42.5');
});
test('wrong PIN never sends CFG_SET',async()=>{
  const h=harness({badPin:true});await h.api.connect();h.csv(sentence());await h.apply();
  assert.deepEqual(h.writes.map(x=>x[0]),[16,1]);assert.equal(h.thermal[16],0);
  assert.match(h.nodes.get('config-status').textContent,/PIN incorreto/);
});
test('armed or stale telemetry disables configuration; binary armed state takes priority',async()=>{
  const h=harness();await h.api.connect();h.csv(sentence('42','ntc','ARMED'));await h.apply();
  assert.equal(h.writes.length,1);assert.equal(h.nodes.get('use-ntc').disabled,true);
  h.csv(sentence());h.binary({flags:1});await h.apply();assert.equal(h.writes.length,1);
  h.binary();h.tick(6000);h.csv(sentence());await h.apply();assert.equal(h.writes.length,1);
  assert.equal(h.nodes.get('v8').textContent,'—');
});
test('arming between CFG_GET and CFG_SET prevents the write',async()=>{
  let h,gets=0;
  h=harness({beforeReply:op=>{if(op===16&&++gets===2)h.binary({flags:1});}});
  await h.api.connect();h.csv(sentence());await h.apply();
  assert.deepEqual(h.writes.map(x=>x[0]),[16,1,16]);assert.equal(h.thermal[16],0);
});
test('firmware refusal and unchanged readback are not reported as success',async()=>{
  for(const options of [{refuseSet:true},{ignoreSet:true}]){
    const h=harness(options);await h.api.connect();h.csv(sentence());await h.apply();
    assert.equal(h.thermal[16],0);assert.match(h.nodes.get('config-status').textContent,/não confirmada/);
  }
});
test('old or incompatible firmware remains read-only and explains selection is unavailable',async()=>{
  for(const options of [{oldFirmware:true},{noCapability:true},{shortConfig:true},{version:2}]){
    const h=harness(options);await h.api.connect();h.csv(sentence());
    assert.equal(h.nodes.get('v8').textContent,'42');assert.equal(h.nodes.get('use-ntc').disabled,true);
    assert.match(h.nodes.get('config-status').textContent,/indisponível/);
    assert.ok(h.writes.every(x=>x[0]===16));
  }
});
test('disconnect clears values, partial frames and authentication state on reconnect',async()=>{
  const h=harness();await h.api.connect();h.csv(sentence());h.csv('$XCTOD,80');
  const old=h.session;h.device.gatt.disconnect();h.tick(6000);
  assert.equal(h.nodes.get('status').textContent,'Desconectado');assert.equal(h.nodes.get('v8').textContent,'—');
  await h.api.connect();assert.notEqual(h.session,old);h.csv('remaining\r\n');
  assert.equal(h.nodes.get('v8').textContent,'—');assert.equal(h.session.buffer,'');
});
test('timeout, malformed/mismatched responses and disconnect reject without retry',async()=>{
  const h=harness({silentOp:1});await h.api.connect();h.csv(sentence());
  const pending=h.apply();await Promise.resolve();
  for(const bytes of [[1,0,0,0],[16,2,0,0],[1,2,0,2,1]]){
    h.chars[UUID.rsp].emit('characteristicvaluechanged',view(Uint8Array.from(bytes)));
    assert.ok(h.session.pending);
  }
  h.timeout();await pending;assert.deepEqual(h.writes.map(x=>x[0]),[16,1]);
  assert.match(h.nodes.get('config-status').textContent,/Sem confirmação/);
  const second=h.apply();await Promise.resolve();h.device.gatt.disconnect();await second;
  assert.equal(h.nodes.get('status').textContent,'Desconectado');
});
test('next request waits for GATT acknowledgement even when response arrived early',async()=>{
  let release;
  const h=harness({ack:op=>op===1?new Promise(resolve=>{release=resolve;}):Promise.resolve()});
  await h.api.connect();h.csv(sentence());const applying=h.apply();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.writes.map(x=>x[0]),[16,1]);
  release();await applying;assert.equal(h.thermal[16],1);
});
