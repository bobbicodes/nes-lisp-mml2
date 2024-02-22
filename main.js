import './style.css'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { clojure } from "./src/clojure"
import { updateDocBar } from "./src/eval-region";
import { updateDebugView } from "./src/debugger";
import * as cpu from "./src/cpu";
import * as apu from "./src/apu";
import * as mapper from "./src/nsfmapper";
import { AudioHandler, samplesPerFrame, sampleBuffer, resume, nextBuffer } from "./src/audiohandler";

let editorState = EditorState.create({
  doc: `(def tempo 1)

(defn zeldabass1 [time note]
  [{:time time  :length 20 :pitch note}
   {:time (+ 1 time) :length 20 :pitch note}
   {:time (+ 2 time) :length 20 :pitch (+ note 7)}
   {:time (+ 3 time) :length 20 :pitch (+ note 7)}
   {:time (+ 4 time) :length 20 :pitch (+ note 12)}
   {:time (+ 5 time) :length 20 :pitch (+ note 12)}
   {:time (+ 6 time) :length 20 :pitch (+ note 12)}
   {:time (+ 7 time) :length 20 :pitch (+ note 12)}])

(defn zeldabass2 [time]
  (apply concat
      (for [[beat note] [[0 46] [8 44] [16 42] [24 41]]]
        (zeldabass1 (+ time beat) note))))

(defn zeldalead1 [time]
       [{:time (+ time 0) :length 20 :pitch 70}
        {:time (+ time 0.1) :length 20 :pitch 70}
        {:time (+ time 0.2) :length 20 :pitch 70}
        {:time (+ time 0.3) :length 20 :pitch 70}
        {:time (+ time 0.4) :length 20 :pitch 70}
        {:time (+ time 0.6) :length 20 :pitch 65}
        {:time (+ time 1) :length 20 :pitch 65}
        {:time (+ time 1.1) :length 20 :pitch 70}
        {:time (+ time 1.2) :length 10 :pitch 68}
        {:time (+ time 1.3) :length 10 :pitch 66}
        {:time (+ time 6.5) :length 20 :pitch 68}
        {:time (+ time 6.6) :length 20 :pitch 68}
        {:time (+ time 6.7) :length 20 :pitch 68}
        {:time (+ time 6.8) :length 20 :pitch 68}
        {:time (+ time 6.9) :length 20 :pitch 68}
        {:time (+ time 7) :length 20 :pitch 68}
        {:time (+ time 7.1) :length 20 :pitch 68}
        {:time (+ time 7.4) :length 20 :pitch 70}
        {:time (+ time 7.5) :length 20 :pitch 70}
        {:time (+ time 7.6) :length 20 :pitch 70}
        {:time (+ time 7.7) :length 20 :pitch 70}
        {:time (+ time 7.8) :length 20 :pitch 70}
        {:time (+ time 10.5) :length 20 :pitch 66}
        {:time (+ time 11) :length 20 :pitch 66}
        {:time (+ time 11.5) :length 20 :pitch 70}
        {:time (+ time 12) :length 10 :pitch 69}
        {:time (+ time 12.25) :length 10 :pitch 67}
        {:time (+ time 12.5) :length 20 :pitch 69}
        {:time (+ time 12.6) :length 20 :pitch 69}
        {:time (+ time 12.7) :length 20 :pitch 69}
        {:time (+ time 12.8) :length 20 :pitch 69}
        {:time (+ time 12.9) :length 20 :pitch 69}
        {:time (+ time 13.6) :length 20 :pitch 69}
        {:time (+ time 13.7) :length 20 :pitch 69}])

(tri-stream (zeldabass2 0))
(sq1-stream (zeldalead1 0))

(play-nsf)`,
  extensions: [basicSetup, clojure()]
})

let view = new EditorView({
  state: editorState,
  parent: document.querySelector('#app')
})

document.querySelector('#app').onclick = (e) => updateDocBar(view)

let audio = new AudioHandler();

export function getByteRep(val) {
  return ("0" + val.toString(16)).slice(-2);
}

export let ram = new Uint8Array(0x800);
export let callArea = new Uint8Array(0x10);
let totalSongs = 0;
let startSong = 0;
let tags = {
  name: "",
  artist: "",
  copyright: ""
}
let playReturned = true;
let frameIrqWanted = false;
let dmcIrqWanted = false;

let paused = false;
let loaded = false;
let pausedInBg = false;
let loopId = 0;

function log(text) {
  el("log").innerHTML += text + "<br>";
  el("log").scrollTop = el("log").scrollHeight;
}

function el(id) {
  return document.getElementById(id);
}

let currentSong = 1;

el("rom").onchange = function (e) {
  resume();
  let freader = new FileReader();
  freader.onload = function () {
    let buf = freader.result;
    let arr = new Uint8Array(buf);
    loadRom(arr);
  }
  freader.readAsArrayBuffer(e.target.files[0]);
}

el("pause").onclick = function (e) {
  if (paused && loaded) {
    loopId = requestAnimationFrame(update);
    audio.start();
    paused = false;
    el("pause").innerText = "Pause";
  } else {
    cancelAnimationFrame(loopId);
    audio.stop();
    paused = true;
    el("pause").innerText = "Unpause";
  }
}

el("reset").onclick = function (e) {
  if (loaded) {
    playSong(currentSong);
  }
}

el("nextsong").onclick = function (e) {
  if (loaded) {
    currentSong++;
    currentSong = currentSong > totalSongs ? totalSongs : currentSong;
    playSong(currentSong);
  }
}

el("prevsong").onclick = function (e) {
  if (loaded) {
    currentSong--;
    currentSong = currentSong < 1 ? 1 : currentSong;
    playSong(currentSong);
  }
}

export let ramCdl = new Uint8Array(0x8000); // addresses $0-$7fff
export let romCdl = new Uint8Array(0x4000);

export function setRamCdl(adr, val) {
  ramCdl[adr] = val
}

export function setRomCdl(adr, val) {
  romCdl[adr] = val
}

export function loadRom(rom) {
  if (loadNsf(rom)) {
    if (!loaded && !paused) {
      loopId = requestAnimationFrame(update);
      audio.start();
    }
    // clear ram cdl, rom cdl
    ramCdl = new Uint8Array(0x8000)
    romCdl = new Uint8Array(0x4000)
    loaded = true;
    currentSong = startSong;
  }
}

function getWordRep(val) {
  return ("000" + val.toString(16)).slice(-4).toUpperCase();
}

export function loadNsf(nsf) {
  if (nsf.length < 0x80) {
    log("Invalid NSF loaded");
    return false;
  }
  if (
    nsf[0] !== 0x4e || nsf[1] !== 0x45 || nsf[2] !== 0x53 ||
    nsf[3] !== 0x4d || nsf[4] !== 0x1a
  ) {
    log("Invalid NSF loaded");
    return false;
  }
  if (nsf[5] !== 1) {
    log("Unknown NSF version: " + nsf[5]);
    return false;
  }
  totalSongs = nsf[6];
  log(totalSongs + " total songs");
  startSong = nsf[7];
  log("Start song: " + startSong);
  let loadAdr = nsf[8] | (nsf[9] << 8);
  log("Load address: $" + getWordRep(loadAdr))
  if (loadAdr < 0x8000) {
    log("Load address less than 0x8000 is not supported");
    return false;
  }
  let initAdr = nsf[0xa] | (nsf[0xb] << 8);
  log("Init address: $" + getWordRep(initAdr))
  let playAdr = nsf[0xc] | (nsf[0xd] << 8);
  log("Play address: $" + getWordRep(playAdr))
  for (let i = 0; i < 32; i++) {
    if (nsf[0xe + i] === 0) {
      break;
    }
    tags.name += String.fromCharCode(nsf[0xe + i]);
  }
  for (let i = 0; i < 32; i++) {
    if (nsf[0x2e + i] === 0) {
      break;
    }
    tags.artist += String.fromCharCode(nsf[0x2e + i]);
  }
  for (let i = 0; i < 32; i++) {
    if (nsf[0x4e + i] === 0) {
      break;
    }
    tags.copyright += String.fromCharCode(nsf[0x4e + i]);
  }
  let initBanks = [0, 0, 0, 0, 0, 0, 0, 0];
  let total = 0;
  for (let i = 0; i < 8; i++) {
    initBanks[i] = nsf[0x70 + i];
    total += nsf[0x70 + i];
  }
  log("Bankswitch init values: " + initBanks)
  let banking = total > 0;

  // set up the NSF mapper

  mapper.set_data(nsf)
  mapper.set_loadAdr(loadAdr)
  mapper.set_banked(banking)
  mapper.set_banks(initBanks)
  mapper.reset()

  callArea[0] = 0x20; // JSR
  callArea[1] = initAdr & 0xff;
  callArea[2] = initAdr >> 8;
  callArea[3] = 0xea // NOP
  callArea[4] = 0xea // NOP
  callArea[5] = 0xea // NOP
  callArea[6] = 0xea // NOP
  callArea[7] = 0xea // NOP
  callArea[8] = 0x20; // JSR
  callArea[9] = playAdr & 0xff;
  callArea[0xa] = playAdr >> 8;
  callArea[0xb] = 0xea // NOP
  callArea[0xc] = 0xea // NOP
  callArea[0xd] = 0xea // NOP
  callArea[0xe] = 0xea // NOP
  callArea[0xf] = 0xea // NOP

  playSong(startSong);
  log("Loaded NSF file");
  return true;
}

function playSong(songNum) {
  // also acts as a reset
  for (let i = 0; i < ram.length; i++) {
    ram[i] = 0;
  }
  playReturned = true;
  apu.reset();
  cpu.reset();
  mapper.reset();
  frameIrqWanted = false;
  dmcIrqWanted = false;
  for (let i = 0x4000; i <= 0x4013; i++) {
    apu.write(i, 0);
  }
  apu.write(0x4015, 0);
  apu.write(0x4015, 0xf);
  apu.write(0x4017, 0x40);

  // run the init routine
  cpu.br[0] = 0x3ff0;
  cpu.r[0] = songNum - 1;
  cpu.r[1] = 0;
  // don't allow init to take more than 10 frames
  let cycleCount = 0;
  let finished = false;
  while (cycleCount < 297800) {
    //console.log("cycling cpu")
    cpu.cycle();
    //console.log("cycling apu")
    apu.cycle();
    if (cpu.br[0] === 0x3ff5) {
      // we are in the nops after the init-routine, it finished
      finished = true;
      break;
    }
    cycleCount++;
  }
  if (!finished) {
    //log("Init did not finish within 10 frames");
  }
}

function update() {
  runFrame();
  loopId = requestAnimationFrame(update);
}

function runFrame() {
  // run the cpu until either a frame has passed, or the play-routine returned
  if (playReturned) {
    cpu.set_pc(0x3ff8)
  }
  playReturned = false;
  let cycleCount = 0;
  while (cycleCount < 29780) {
    cpu.setIrqWanted(dmcIrqWanted || frameIrqWanted)
    if (!playReturned) {
      cpu.cycle();
    }
    apu.cycle();
    if (cpu.br[0] === 0x3ffd) {
      // we are in the nops after the play-routine, it finished
      playReturned = true;
    }
    cycleCount++;
  }
  getSamples(sampleBuffer, samplesPerFrame);
  nextBuffer();
  //updateDebugView()
}

function getSamples(data, count) {
  // apu returns 29780 or 29781 samples (0 - 1) for a frame
  // we need count values (0 - 1)
  let samples = apu.getOutput();
  let runAdd = (29780 / count);
  let total = 0;
  let inputPos = 0;
  let running = 0;
  for (let i = 0; i < count; i++) {
    running += runAdd;
    let total = 0;
    let avgCount = running & 0xffff;
    for (let j = inputPos; j < inputPos + avgCount; j++) {
      total += samples[1][j];
    }
    data[i] = total / avgCount;
    inputPos += avgCount;
    running -= avgCount;
  }
}

export function read(adr) {
  adr &= 0xffff;

  if (adr < 0x2000) {
    // ram
    return ram[adr & 0x7ff];
  }
  if (adr < 0x3ff0) {
    // ppu ports, not readable in NSF
    return 0;
  }
  if (adr < 0x4000) {
    // special call area used internally by player
    return callArea[adr & 0xf];
  }
  if (adr < 0x4020) {
    // apu/misc ports
    if (adr === 0x4014) {
      return 0; // not readable
    }
    if (adr === 0x4016 || adr === 0x4017) {
      return 0; // not readable in NSF
    }
    return apu.read(adr);
  }
  return mapper.read(adr);
}

export function write(adr, value) {
  adr &= 0xffff;

  if (adr < 0x2000) {
    // ram
    ram[adr & 0x7ff] = value;
    return;
  }
  if (adr < 0x4000) {
    // ppu ports, not writable in NSF
    return;
  }
  if (adr < 0x4020) {
    // apu/misc ports
    if (adr === 0x4014 || adr === 0x4016) {
      // not writable in NSF
      return;
    }
    apu.write(adr, value);
    return;
  }
  mapper.write(adr, value);
}
