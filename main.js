import './style.css'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { clojure } from "./src/clojure"
import confuzion from './confuzion.json'

let editorState = EditorState.create({
  doc: `(for [{:keys [pitch length time]} bass]
  (play (tri (- pitch 26) length) (/ (+ 3 time) 2.5)))

(for [{:keys [length time]} drums]
  (play (fade (noise 60 length)) (/ (+ 3 time) 2.5)))
  
(for [{:keys [pitch length time]} lead1]
  (play (pulse0 pitch length) (/ (+ 3 time) 2.5)))
  
(for [{:keys [pitch length time]} lead2]
  (play (pulse2 pitch length) (/ (- time 30) 2.5)))`,
  extensions: [basicSetup, clojure()]
})

let view = new EditorView({
  state: editorState,
  parent: document.querySelector('#app')
})