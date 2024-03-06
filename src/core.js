import { read_str } from './reader.js';
import { _pr_str, _println } from './printer.js'
import * as types from './types.js'
import { repl_env, evalString, PRINT, EVAL } from './interpreter.js';
import zip from './clj/zip.clj?raw'
import * as audio from './audio.js'
import { nsfDriver, assembleDriver } from './nsf.js';
import { loadNsf, loadRom, exportAudio } from '../main.js';
import { resetNSF } from './cpu.js';

export var out_buffer = ""

export function appendBuffer(s) {
    out_buffer = out_buffer + s
}

export function clearBuffer() {
    out_buffer = ""
}

function _print(s) {
    appendBuffer(s)
}

function _pr(s) {
    if (arguments.length > 1) {
        appendBuffer(Array.from(arguments).join(' '))
    } else {
        appendBuffer(s)
    }
}

// Errors/Exceptions
function mal_throw(exc) { throw new Error(exc); }

// String functions
function pr_str() {
    return Array.prototype.map.call(arguments, function (exp) {
        return _pr_str(exp, true);
    }).join(" ");
}

function str() {
    const args = Array.from(arguments).filter(v => v !== null);
    return Array.prototype.map.call(args, function (exp) {
        return _pr_str(exp, false);
    }).join("");
}

function prn(s) {
    if (arguments.length > 1) {
        appendBuffer(Array.from(arguments).join(' ') + "\n")
    } else {
        appendBuffer(s + "\n")
    }
}

function println() {
    _println.apply({}, Array.prototype.map.call(arguments, function (exp) {
        appendBuffer(exp + "\n")
        return _pr_str(exp, false);
    }));
}

function consolePrint() {
    _println.apply({}, Array.prototype.map.call(arguments, function (exp) {
        return _pr_str(exp, false);
    }));
}

function slurp(f) {
    if (typeof require !== 'undefined') {
        return require('fs').readFileSync(f, 'utf-8');
    } else {
        var req = new XMLHttpRequest();
        req.open("GET", f, false);
        req.send();
        if (req.status == 200) {
            return req.responseText;
        } else {
            throw new Error("Failed to slurp file: " + f);
        }
    }
}

// Number functions
function time_ms() { return new Date().getTime(); }


// Hash Map functions
function assoc(src_hm) {
    if (src_hm === null) {
        src_hm = new Map()
    }
    var hm = types._clone(src_hm);
    var args = [hm].concat(Array.prototype.slice.call(arguments, 1));
    return types._assoc_BANG.apply(null, args);
}

function dissoc(src_hm) {
    var hm = types._clone(src_hm);
    var args = [hm].concat(Array.prototype.slice.call(arguments, 1));
    return types._dissoc_BANG.apply(null, args);
}

export function get(coll, key, notfound) {
    if (types._vector_Q(coll)) {
        return coll[key]
    }
    if (types._string_Q(coll)) {
        return coll[key]
    }
    if (types._hash_map_Q(coll)) {
        for (const [k, value] of coll) {
            if (types._equal_Q(k, key)) {
                return value
            }
        }
        return notfound
    }
    if (coll != null) {
        return coll.get(key) || notfound
    } else {
        return null;
    }
}

export function contains_Q(coll, key) {
    if (coll === null) {
        return false
    }
    if (types._hash_map_Q(coll)) {
        for (const [k, value] of coll) {
            if (types._equal_Q(k, key)) {
                return true
            }
        }
    }
    if (types._set_Q(coll)) {
        for (const item of coll) {
            if (types._equal_Q(item, key)) {
                return true
            }
        }
        return false
    }
    if (key in coll) { return true; } else { return false; }
}

function keys(hm) { return Array.from(hm.keys()) }
function vals(hm) { return Array.from(hm.values()) }


// Sequence functions
export function cons(a, b) {
    if (b != null && b.name === 'LazySeq') {
        return lazyCons(a, b)
    }
    return [a].concat(b);
}

export function lazyCons(x, coll) {
    return lazy(function* () {
        yield x;
        yield* iterable(coll);
    });
}

function concat(lst) {
    lst = lst || [];
    return lst.concat.apply(lst, Array.prototype.slice.call(arguments, 1));
}
function vec(lst) {
    if (types._list_Q(lst)) {
        var v = Array.prototype.slice.call(lst, 0);
        v.__isvector__ = true;
        return v;
    } else {
        return lst;
    }
}

function re_matches(re, s) {
    let matches = re.exec(s);
    if (matches && s === matches[0]) {
        if (matches.length === 1) {
            return matches[0];
        } else {
            return matches;
        }
    }
}

function re_find(re, s) {
    let matches = re.exec(s);
    if (matches) {
        if (matches.length === 1) {
            return matches[0];
        } else {
            return matches;
        }
    }
}

function re_seq(re, s) {
    if (s === null) {
        return null
    }
    const array = [...s.matchAll(re)];
    const firsts = array.map(x => x[0])
    if (firsts.length === 0) {
        return null
    }
    return firsts
}

export function nth(coll, idx, notfound) {
    if (types._lazy_iterable_Q(coll)) {
        if (coll) {
            var elt = undefined;
            if (coll instanceof Array) {
                elt = coll[idx];
            } else {
                let iter = iterable(coll);
                let i = 0;
                for (let value of iter) {
                    if (i++ == idx) {
                        elt = value;
                        break;
                    }
                }
            }
            if (elt !== undefined) {
                return elt;
            }
        }
        return notfound;
    }
    if (idx < coll.length) { return coll[idx]; }
    else { return notfound }
}

export function first(lst) {
    if (types._lazy_range_Q(lst)) {
        return 0
    }
    return (lst === null || lst.length === 0) ? null : seq(lst)[0];
}

export function second(lst) { return (lst === null || lst.length === 0) ? null : seq(lst)[1]; }
export function last(lst) { return (lst === null || lst.length === 0) ? null : seq(lst)[seq(lst).length - 1]; }

export function rest(lst) {
    //console.log("[rest]", lst)
    if (types._lazy_iterable_Q(lst) || types._lazy_seq_Q(lst)) {
        return lazy(function* () {
            let first = true;
            for (const x of iterable(coll)) {
                if (first) first = false;
                else yield x;
            }
        });
    }
    return (lst == null || lst.length === 0) ? [] : seq(lst).slice(1);
}

function empty_Q(lst) {
    if (types._set_Q(lst) || types._hash_map_Q(lst)) {
        if (lst.size === 0) {
            return true
        } else {
            return false
        }
    }
    if (!lst) {
        return true
    }
    return lst.length === 0;
}

export function count(s) {
    if (types._hash_map_Q(s)) { return s.size; }
    if (Array.isArray(s)) { return s.length; }
    if (types._set_Q(s)) { return s.size; }
    else if (s === null) { return 0; }
    else { return Object.keys(s).length; }
}

function conj(lst) {
    if (types._iterate_Q(lst)) {
        return "TODO: implement iterate on conj"
    }
    if (types._list_Q(lst)) {
        return Array.prototype.slice.call(arguments, 1).reverse().concat(lst);
    } else if (types._vector_Q(lst)) {
        var v = lst.concat(Array.prototype.slice.call(arguments, 1));
        v.__isvector__ = true;
        return v;
    } else if (types._set_Q(lst)) {
        return lst.add(arguments[1])
    } else if (types._hash_map_Q(lst)) {
        if (arguments.length === 2 && arguments[1].size === 0) {
            return lst
        }
        var hm = new Map(lst)
        const args = Array.prototype.slice.call(arguments, 1)
        let seqs = []
        for (const arg of args) {
            if (types._hash_map_Q(arg)) {
                seqs = seqs.concat(seq(arg))
            } else {
                seqs.push(arg)
            }
        }
        for (var i = 0; i < seqs.length; i++) {
            hm.set(seqs[i][0], seqs[i][1])
        }
        return hm
    }
}

function re_pattern(s) {
    return new RegExp(s, 'g')
}

function split(s, re) {
    return s.split(re)
}

export function seq(obj) {
    if (types._list_Q(obj)) {
        return obj.length > 0 ? obj : null;
    } else if (types._iterate_Q(obj)) {
        return obj.realized
    } else if (types._vector_Q(obj)) {
        return obj.length > 0 ? Array.prototype.slice.call(obj, 0) : null;
    } else if (types._string_Q(obj)) {
        return obj.length > 0 ? obj.split('') : null;
    } else if (types._hash_map_Q(obj)) {
        return obj.size > 0 ? [...obj.entries()] : null;
    } else if (types._set_Q(obj)) {
        return Array.from(obj)
    }
    else if (obj === null) {
        return null;
    } else {
        return obj
    }
}


function apply(f) {
    var args = Array.prototype.slice.call(arguments, 1);
    return f.apply(f, args.slice(0, args.length - 1).concat(args[args.length - 1]));
}


// Metadata functions
export function with_meta(obj, m) {
    var new_obj = types._clone(obj);
    new_obj.__meta__ = m;
    return new_obj;
}

export function meta(obj) {
    // TODO: support atoms
    if ((!types._sequential_Q(obj)) &&
        (!(types._hash_map_Q(obj))) &&
        (!(types._function_Q(obj))) &&
        (!(types._symbol_Q(obj)))) {
        throw new Error("attempt to get metadata from: " + types._obj_type(obj));
    }
    return obj.__meta__;
}


// Atom functions
function deref(atm) { return atm.val; }
function reset_BANG(atm, val) { return atm.val = val; }
function swap_BANG(atm, f) {
    var args = [atm.val].concat(Array.prototype.slice.call(arguments, 2));
    atm.val = f.apply(f, args);
    return atm.val;
}

function js_eval(str) {
    return js_to_mal(eval(str.toString()));
}

function js_method_call(object_method_str) {
    var args = Array.prototype.slice.call(arguments, 1),
        r = resolve_js(object_method_str),
        obj = r[0], f = r[1];
    var res = f.apply(obj, args);
    return js_to_mal(res);
}

function toSet(coll) {
    var new_set = new Set()
    for (const item of seq(coll)) {
        if (!contains_Q(new_set, item)) {
            new_set.add(item)
        }
    }
    return new_set
}

function _union(setA, setB) {
    const _union = new Set(setA);
    for (const elem of setB) {
        if (!contains_Q(_union, elem)) {
            _union.add(elem);
        }
    }
    return _union;
}

function _intersection(setA, setB) {
    const _intersection = new Set();
    for (const elem of setB) {
        if (contains_Q(setA, (elem))) {
            _intersection.add(elem);
        }
    }
    return _intersection;
}

function setDelete(set, item) {
    var new_set = new Set()
    for (const i of set) {
        if (!types._equal_Q(i, item)) {
            new_set.add(i)
        }
    }
    return new_set
}

function symmetricDifference(setA, setB) {
    var _difference = new Set(setA);
    for (const elem of setB) {
        if (contains_Q(_difference, elem)) {
            _difference = setDelete(_difference, elem);
        } else {
            _difference.add(elem);
        }
    }
    return _difference;
}

function _difference(setA, setB) {
    var _difference = new Set(setA);
    for (const elem of setB) {
        _difference = setDelete(_difference, elem);
    }
    return _difference;
}

function _disj(set) {
    var args = Array.from(arguments).slice(1)
    var new_set = types._clone(set)
    for (let i = 0; i < args.length; i++) {
        new_set.delete(args[i])
    }
    return new_set
}

function _is(a) {
    if (a) {
        return true
    } else {
        return false
    }
}

function resolve_js(str) {
    if (str.match(/\./)) {
        var re = /^(.*)\.[^\.]*$/,
            match = re.exec(str);
        return [eval(match[1]), eval(str)];
    } else {
        return [GLOBAL, eval(str)];
    }
}

function js_to_mal(obj) {
    if (obj === null || obj === undefined) {
        return null;
    }
    var cache = [];
    var str = JSON.stringify(obj, function (key, value) {
        if (typeof value === 'object' && value !== null) {
            if (cache.indexOf(value) !== -1) {
                // Circular reference found, discard key
                return;
            }
            // Store value in our collection
            cache.push(value);
        }
        return value;
    });
    cache = null; // Enable garbage collection
    return JSON.parse(str);
}

function map(f, s) {
    if (types._string_Q(s)) {
        s = seq(s)
    }
    return s.map(function (el) { return f(el); });
}

function int(x) {
    if (types._ratio_Q(x)) {
        return x.floor()
    }
    if (types._number_Q(x)) {
        return Math.floor(x)
    } else if (x[0] === '\\') {
        // is a char
        return x.charCodeAt(1)
    } else {
        return x.charCodeAt(0)
    }
}

function double(x) {
    if (types._ratio_Q(x)) {
        return x.n / x.d
    }
    return x
}

function char(int) {
    return String.fromCharCode(int)
}

function filter(f, lst) {
    if (types._lazy_iterable_Q(lst)) {
        return lazy(function* () {
            for (const x of iterable(coll)) {
                if (pred(x)) {
                    yield x;
                }
            }
        });
    }
    if (types._iterate_Q(lst)) {
        return "TODO: filter iterate object"
    }
    if (!lst || lst.length === 0) {
        return []
    }
    if (types._set_Q(f)) {
        return seq(lst).filter(function (el) { return f.has(el); });
    }
    return seq(lst).filter(function (el) { return f(el); })
}

function min() {
    return Math.min.apply(null, arguments);
}

function max() {
    return Math.max.apply(null, arguments);
}

function _pow(x, n) {
    return Math.pow(x, n)
}

function _abs(n) {
    return Math.abs(n)
}

function sum() {
    if (Array.from(arguments).length === 0) {
        return 0
    }
    var res = Array.from(arguments).reduce((acc, a) => acc + a, 0);
    if (Array.from(arguments).every(function (element) { return types._ratio_Q(element) })) {
        res = types._ratio(res)
    }
    return res
}

function subtract() {
    if (arguments.length === 1) {
        return subtract(types._ratio(0), arguments[0])
    }
    var res = Array.from(arguments).slice(1).reduce((acc, a) => acc - a, arguments[0]);
    if (Array.from(arguments).every(function (element) { return types._ratio_Q(element) })) {
        res = types._ratio(res)
    }
    return res
}

function product() {
    if (arguments.length === 0) {
        return 1
    }
    var res = Array.from(arguments).reduce((acc, a) => acc * a, 1);
    if (Array.from(arguments).every(function (element) { return types._ratio_Q(element) })) {
        res = types._ratio(res)
    }
    return res
}

/* function divide() {
    if (arguments[0] === 0) {
        return 0
    }
    if (arguments.length === 2 && Number.isInteger(arguments[0])
        && Number.isInteger(arguments[1]) && arguments[1] != 1) {
        var quotient = types._ratio({ n: arguments[0], d: arguments[1] })
        if (quotient.d === 1) {
            return quotient.n
        } else {
            return quotient
        }
    }
    var divisor = arguments[0]
    var res = Array.from(arguments).slice(1).reduce((acc, a) => acc / a, divisor);
    if (Array.from(arguments).every(function (element) { return types._ratio_Q(element) })) {
        res = types._ratio(res)
    }
    return res
} */

function divide(n, d) {
    return n / d
}

// https://github.com/squint-cljs/squint/blob/main/src/squint/core.js
class LazyIterable {
    constructor(gen) {
        this.name = 'LazyIterable'
        this.gen = gen;
    }
    [Symbol.iterator]() {
        return this.gen();
    }
}

export function lazy(f) {
    //console.log("creating lazy-iterable of", f)
    return new LazyIterable(f);
}

export function seqable_QMARK_(x) {
    // String is iterable but doesn't allow `m in s`
    return typeof x === 'string' || x === null || x === undefined || Symbol.iterator in x;
}

export function iterable(x) {
    // nil puns to empty iterable, support passing nil to first/rest/reduce, etc.
    if (x === null || x === undefined) {
        return [];
    }
    if (seqable_QMARK_(x)) {
        return x;
    }
    return Object.entries(x);
}

export class LazySeq {
    constructor(f) {
        this.name = 'LazySeq'
        this.f = f;
    }
    *[Symbol.iterator]() {
        yield* iterable(this.f());
    }
}

export function take(n, coll) {
    //console.log("[take]", coll)
    if (empty_Q(coll)) {
        return []
    }
    if (types._lazy_range_Q(coll)) {
        return range(0, n)
    }
    if (types._lazy_seq_Q(coll) || types._lazy_iterable_Q(coll)) {
        return lazy(function* () {
            let i = n - 1;
            for (const x of iterable(coll)) {
                if (i-- >= 0) {
                    yield x;
                }
                if (i < 0) {
                    return;
                }
            }
        });
    }
    if (types._iterate_Q(coll)) {
        for (let i = 0; i < n; i++) {
            coll.next()
        }
        return coll.realized.slice(0, -1)
    }
    if (types._cycle_Q(coll)) {
        const cycles = Math.floor(n / coll.coll.length)
        const mod = n % coll.coll.length
        let res = []
        for (let i = 0; i < cycles; i++) {
            res = res.concat(coll.coll)
        }
        if (mod != 0) {
            res = res.concat(coll.coll.slice(0, mod))
        }
        return res
    }
    return seq(coll).slice(0, n)
}

function drop(n, coll) {
    if (coll === null) {
        return []
    }
    if (empty_Q(coll)) {
        return []
    }
    return seq(coll).slice(n)
}

function repeat(n, x) {
    return Array(n).fill(x)
}



// lazy ranges
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Iterators_and_Generators#generator_functions
function* makeRangeIterator(start = 0, end = Infinity, step = 1) {
    let iterationCount = 0;
    for (let i = start; i < end; i += step) {
        iterationCount++;
        yield i;
    }
    return iterationCount;
}

function range(start, end, step) {
    if (arguments.length === 0) {
        // uses above generator
        var iterator = makeRangeIterator()
        iterator.name = 'lazyRange'
        return iterator
    }
    if (step < 0) {
        var ans = [];
        for (let i = start; i > end; i += step) {
            ans.push(i);
        }
        return ans
    }
    if (!end) {
        if (start === 0) {
            return []
        }
        return range(0, start)
    }
    var ans = [];
    if (step) {
        for (let i = start; i < end; i += step) {
            ans.push(i);
        }
        return ans
    }
    for (let i = start; i < end; i++) {
        ans.push(i);
    }
    return ans;
}

export function iterate(f, x) {
    var current = x;
    return lazy(function* () {
        while (true) {
            yield current;
            current = f(current);
        }
    });
}

class Cycle {
    constructor(coll) {
        this.name = 'Cycle'
        this.coll = coll
    }
}

function cycle(coll) {
    return new Cycle(coll)
}

function mod(x, y) {
    return x % y
}


function sort(x) {
    if (types._string_Q(x)) {
        return x.split('').sort().join('');
    }
    if (types._list_Q(x)) {
        return x.sort(subtract)
    }
    if (types._hash_map_Q(x)) {
        return new Map(Array.from(x).sort(subtract))
    }
    if (types._set_Q(x)) {
        return new Set(Array.from(x).sort(subtract))
    } else {
        var v = x.sort(subtract)
        v.__isvector__ = true;
        return v;
    }
}

function makeComparator(f) {
    return function (x, y) {
        let r = f(x, y)
        if (types._number_Q(r)) {
            return r
        } else if (r) {
            return -1
        } else if (f(y, x)) {
            return 1
        } else {
            return 0
        }
    }
}

function sort_by() {
    if (arguments.length === 2) {
        var keyfn = arguments[0]
        var x = arguments[1]
        var comp = subtract
    }
    if (arguments.length === 3) {
        var keyfn = arguments[0]
        var comp = makeComparator(arguments[1])
        var x = arguments[2]
    }
    if (types._keyword_Q(keyfn)) {
        var comparator = (a, b) => comp(get(a, keyfn), get(b, keyfn))
    } else {
        var comparator = (a, b) => comp(keyfn(a), keyfn(b))
    }
    if (types._string_Q(x)) {
        return x.split('').sort(comparator).join('');
    }
    if (types._list_Q(x)) {
        return x.sort(comparator)
    }
    if (types._hash_map_Q(x)) {
        return new Map(Array.from(x).sort(comparator))
    }
    if (types._set_Q(x)) {
        return new Set(Array.from(x).sort(comparator))
    } else {
        var v = x.sort(comparator)
        v.__isvector__ = true;
        return v;
    }
}

function pop(lst) {
    if (types._list_Q(lst)) {
        return lst.slice(1);
    } else {
        var v = lst.slice(0, -1);
        v.__isvector__ = true;
        return v;
    }
}

function peek(lst) {
    if (types._list_Q(lst)) {
        return lst[0]
    } else {
        return lst[lst.length - 1]
    }
}

function upperCase(s) {
    return s.toUpperCase()
}

function isLetter(c) {
    return c.toLowerCase() != c.toUpperCase();
}

function lowerCase(s) {
    return s.toLowerCase()
}

function int_Q(x) {
    return Number.isInteger(x)
}

function _join(separator, coll) {
    if (!coll) {
        return separator.join('')
    }
    return coll.join(separator)
}

function _replace(s, match, replacement) {
    return s.replace(match, replacement)
}

function rand_int() {
    return Math.floor(Math.random() * arguments[0]);
}

function rand_nth() {
    const n = Math.floor(Math.random() * arguments[0].length)
    return arguments[0][n]
}

function _round(n) {
    return Math.round(n)
}

function _sin(n) {
    return Math.sin(n)
}

function _sqrt(n) {
    return Math.sqrt(n)
}

function _substring(s, start, end) {
    if (!end) {
        return s.substring(start, s.length)
    }
    return s.substring(start, end)
}

function dec2bin(dec) {
    return (dec >>> 0).toString(2);
}

function repeatedly(n, f) {
    let calls = []
    for (let i = 0; i < n; i++) {
        calls.push(f())
    }
    return calls
}

function _subvec(v, start, end) {
    return v.slice(start, end)
}

function _trim(s) {
    return s.trim()
}

// function to print env for debugging

function printEnv() {
    console.log(repl_env)
}

function _require(lib) {
    switch (lib) {
        case 'zip':
            evalString("(do " + zip + ")")
            break;
        case 'set':
            evalString("(do " + clj_set + ")")
            break;
        default:
            break;
    }
}

function downloadObjectAsJson(exportObj, exportName) {
    var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj));
    var downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", exportName);
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function spit_json(name, obj) {
    return downloadObjectAsJson(obj, name)
}

function map_indexed(f, coll) {
    let ret = [];
    let i = 0;
    for (const x of coll) {
        ret.push(f(i, x));
        i++;
    }
    return ret;
}

function _isNaN(n) {
    if (isNaN(n)) {
        return true
    } else {
        return false
    }
}

function _map(f, colls) {
    var map_fn = f
    var n = colls.length
    var r = [...Array(n).keys()]
    var loopKeys = r.map(x => types._symbol('s' + x))
    var loopVals = colls.map(x => seq(x))
    var bindings = r.flatMap((n) => {
        var v = loopVals[n]
        v.__isvector__ = true
        var b = [loopKeys[n], v]
        b.__isvector__ = true
        return b
    })
    var res = []
    res.__isvector__ = true
    bindings.push(types._symbol('res'), res)
    bindings.__isvector__ = true
    var pred = [types._symbol('or')]
        .concat(loopKeys.map(x => [types._symbol('empty?'), x]))
    var recur1 = [types._symbol('recur')]
        .concat(loopKeys.map(x => [types._symbol('rest'), x]))
    var recur2 = [types._symbol('conj'), types._symbol('res')]
    recur2.push([map_fn]
        .concat(loopKeys.map(x => [types._symbol('first'), x])))
    var recur = recur1.concat([recur2])
    var loop = [types._symbol('loop')]
    loop.push(bindings)
    loop.push([types._symbol('if'), pred,
    [types._symbol('apply'), types._symbol('list'), types._symbol('res')],
        recur])
    return EVAL(loop, repl_env)
}

function appendPath(d, color, x, y, scale) {
    var newElement = document.createElementNS("http://www.w3.org/2000/svg", 'path');
    newElement.setAttribute("d", d)
    newElement.style.stroke = color || "black"
    newElement.style.strokeWidth = "1";
    newElement.style.fill = "lightgreen";
    if (scale) {
        newElement.setAttribute("transform", "translate(" + x.toString() + "," + y.toString() + ") scale(" + scale + ")")
    } else if (typeof x === 'number') {
        newElement.setAttribute("transform", "translate(" + x.toString() + "," + y.toString() + ")")
    }
    svgGroup.appendChild(newElement);
}

function clearSVG() {
    svgGroup.innerHTML = ""
}

function hex2bin(hex) {
    return (parseInt(hex, 16).toString(2)).padStart(8, '0');
}

// this will take a hex string, i.e. "FFFF0F00000000000000000000000000"
// outputs a string of binary digits: "111111111111111111110000000000000000000 ..."

export function hex2DPCM(hex) {
    const bytes = hex.match(/../g);
    const le = bytes.map(x => x.split("").reverse().join(""))
    return le.map(x => hex2bin(x)).join("")
}

// takes a hex string, outputs an array of binary digits repeated n times

function loopDPCM(s, n) {
    return (hex2DPCM(s).repeat(n)).split('').map(x => parseInt(x, 10))
}

function dpcm2pcm(vals, rate) {
    let newFrames = []
    for (let i = 0; i < vals.length; i++) {
        newFrames.push(Math.floor(i * rate))
    }
    let output = 32
    let result = [32]
    for (let i = 0; i < (vals.length * rate); i++) {
        if (i === newFrames[0]) {
            vals.shift()
            newFrames.shift()
        }
        let v = vals[0] == 0 ? output - 1 : output + 1
        if (v > 1 && v < 63) {
            output = v
        }
        result.push(output)
    }
    return scalePCM(result)
}

function scalePCM(vals) {
    let scaled = []
    for (let i = 0; i < vals.length; i++) {
        scaled.push(((vals[i] / 64) * 2) - 1)
        //console.log("scaling " + vals[i] + " to " + (((vals[i]/64) * 2) - 1))
    }
    return scaled
}

const sample0 = document.getElementById('dpcm0')
const sample1 = document.getElementById('dpcm1')
const sample2 = document.getElementById('dpcm2')
const sample3 = document.getElementById('dpcm3')

let dpcm_0
let dpcm_1
let dpcm_2
let dpcm_3

sample0.onchange = (e) => {
    const file = sample0.files[0]
    var reader = new FileReader
    reader.readAsArrayBuffer(file)
    reader.onload = (e) => {
        var buf = new Uint8Array(e.target.result)
        var hex = Array.from(buf).map((b) => b.toString(16).padStart(2, "0"))
            .join("").toUpperCase()
            dpcm_0 = hex
    }
}

sample1.onchange = (e) => {
    const file = sample1.files[0]
    var reader = new FileReader
    reader.readAsArrayBuffer(file)
    reader.onload = (e) => {
        var buf = new Uint8Array(e.target.result)
        var hex = Array.from(buf).map((b) => b.toString(16).padStart(2, "0"))
            .join("").toUpperCase()
            dpcm_1 = hex
    }
}

sample2.onchange = (e) => {
    const file = sample2.files[0]
    var reader = new FileReader
    reader.readAsArrayBuffer(file)
    reader.onload = (e) => {
        var buf = new Uint8Array(e.target.result)
        var hex = Array.from(buf).map((b) => b.toString(16).padStart(2, "0"))
            .join("").toUpperCase()
            dpcm_2 = hex
    }
}

sample3.onchange = (e) => {
    const file = sample3.files[0]
    var reader = new FileReader
    reader.readAsArrayBuffer(file)
    reader.onload = (e) => {
        var buf = new Uint8Array(e.target.result)
        var hex = Array.from(buf).map((b) => b.toString(16).padStart(2, "0"))
            .join("").toUpperCase()
            dpcm_3 = hex
    }
}

function dpcm0() {
    return dpcm_0
}

function dpcm1() {
    return dpcm_1
}
function dpcm2() {
    return dpcm_2
}
function dpcm3() {
    return dpcm_3
}

function playNSF(square1, square2, triangle, noise) {
    audio.resetSongLength()
    square1 = audio.assembleStream(square1)
    square2 = audio.assembleStream(square2)
    triangle = audio.assembleStream(triangle)
    noise = audio.assembleNoise(noise)
    assembleDriver(square1, square2, triangle, noise)
    resetNSF()
    loadRom(nsfDriver)
    console.log("song length: " + audio.songLength + " frames")
}

function saveWav(square1, square2, triangle, noise) {
    audio.resetSongLength()
    square1 = audio.assembleStream(square1)
    square2 = audio.assembleStream(square2)
    triangle = audio.assembleStream(triangle)
    noise = audio.assembleNoise(noise)
    assembleDriver(square1, square2, triangle, noise)
    resetNSF()
    console.log("song length: " + audio.songLength)
    exportAudio(nsfDriver)
}

function sq1Stream(notes) {
    audio.setSq1Stream(audio.assembleStream(notes))
    return audio.sq1Stream 
}

function sq2Stream(notes) {
    audio.setSq2Stream(audio.assembleStream(notes))
    return audio.sq2Stream
}

function triStream(notes) {
    audio.setTriStream(audio.assembleStream(notes))
    return audio.triStream
}

function noiseStream(notes) {
    audio.setNoiseStream(audio.assembleStream(notes))
    return audio.noiseStream
}

function hex(n) {
    return (n).toString(16);
}

function spitNSF(name) {
    let buffer = new ArrayBuffer(nsfDriver.length);
    let view = new DataView(buffer)
    for (let i = 0; i < nsfDriver.length; i++) {
      view.setInt8(i, nsfDriver[i]); 
    }
    const blob = new Blob([view], { type: "application/octet-stream" }); 
    var new_file = URL.createObjectURL(blob);
    var downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", new_file);
    downloadAnchorNode.setAttribute("download", name);
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

// types.ns is namespace of type functions
export var ns = {
    'env': printEnv,
    'hex': hex,
    'spit-nsf': spitNSF,
    'play': audio.playBuffer,
    'play-nsf': playNSF,
    'export-wav': saveWav,
    'square1': sq1Stream,
    'square2': sq2Stream,
    'triangle': triStream,
    'noise': noiseStream,
    'mix': audio.mix,
    'dpcm-0': dpcm0,
    'dpcm-1': dpcm1,
    'dpcm-2': dpcm2,
    'dpcm-3': dpcm3,
    'dpcm-seq': audio.dpcm_seq,
    'tri-seq': audio.tri_seq,
    'drum-seq': audio.drum_seq,
    'pulse0-seq': audio.pulse0_seq,
    'hex2bin': hex2bin,
    'dec2bin': dec2bin,
    'hex2dpcm': hex2DPCM,
    'loop-dpcm': loopDPCM,
    'dpcm2pcm': dpcm2pcm,
    'pulse1-seq': audio.pulse1_seq,
    'pulse2-seq': audio.pulse2_seq,
    'pulse3-seq': audio.pulse3_seq,
    'channel-data': audio.channelData,
    'midi->freq': audio.midiToFreq,
    'spit-wav': audio.make_download,
    'append-path': appendPath,
    'clear-svg': clearSVG,
    'console-print': consolePrint,
    '_map': _map,
    'print': _print,
    'Integer/parseInt': parseInt,
    'js/parseInt': parseInt,
    'js/Number.POSITIVE_INFINITY': Number.POSITIVE_INFINITY,
    'js/Number.NEGATIVE_INFINITY': Number.NEGATIVE_INFINITY,
    'nan?': _isNaN,
    'pr': _pr,
    'spit-json': spit_json,
    'LazySeq': LazySeq,
    'lazy-cons': lazyCons,
    'require': _require,
    'type': types._obj_type,
    '=': types.allEqual,
    '==': types.allEqual,
    'throw': mal_throw,
    'nil?': types._nil_Q,
    'true?': types._true_Q,
    'is': _is,
    'false?': types._false_Q,
    'ratio?': types._ratio_Q,
    'number?': types._number_Q,
    'string?': types._string_Q,
    'symbol': types._symbol,
    'symbol?': types._symbol_Q,
    'set?': types._set_Q,
    'keyword': types._keyword,
    'keyword?': types._keyword_Q,
    'map-entry?': types._mapEntry_Q,
    're-matches': re_matches,
    're-find': re_find,
    'fn?': types._fn_Q,
    'macro?': types._macro_Q,
    'char': char,
    'int?': int_Q,
    'repeatedly': repeatedly,
    'rand-int': rand_int,
    'rand-nth': rand_nth,
    'Math/round': _round,
    'Math/sqrt': _sqrt,
    'Math/pow': _pow,
    'Math/abs': _abs,
    'sin': _sin,
    'abs': _abs,
    'Integer/toBinaryString': dec2bin,
    'str/trim': _trim,
    'cycle': cycle,
    'str/split': split,
    're-pattern': re_pattern,
    'double': double,
    'pr-str': pr_str,
    'str': str,
    'prn': prn,
    'println': println,
    //'readline': readline.readline,
    'read-string': read_str,
    'slurp': slurp,
    'lt': function (a, b) { return a < b; },
    'lte': function (a, b) { return a <= b; },
    'gt': function (a, b) { return a > b; },
    'gte': function (a, b) { return a >= b; },
    '+': sum,
    '-': subtract,
    '*': product,
    '/': divide,
    'inc': function (a) { return a + 1; },
    "time-ms": time_ms,
    'max': max,
    'min': min,
    'range': range,
    'sort': sort,
    'peek': peek,
    'pop': pop,
    'lower-case': lowerCase,
    'upper-case': upperCase,
    'str/lower-case': lowerCase,
    'str/upper-case': upperCase,
    //'isletter': isLetter,
    'subs': _substring,
    'subvec': _subvec,
    'map-indexed': map_indexed,
    'list': types._list,
    'list?': types._list_Q,
    'vector': types._vector,
    'vector?': types._vector_Q,
    'hash-map': types._hash_map,
    'map?': types._hash_map_Q,
    'assoc': assoc,
    'dissoc': dissoc,
    'get': get,
    're-seq': re_seq,
    'contains?': contains_Q,
    'keys': keys,
    'vals': vals,
    'int': int,
    //'mod': mod,
    'rem': mod,
    'iterate': iterate,
    'walk': types.walk,
    'sort-by': sort_by,
    'sequential?': types._sequential_Q,
    'cons': cons,
    'concat': concat,
    'vec': vec,
    'nth': nth,
    'first': first,
    'second': second,
    'rest': rest,
    'last': last,
    'take': take,
    'drop': drop,
    'empty?': empty_Q,
    'count': count,
    'apply*': apply,
    //'map': map,
    'repeat': repeat,
    'join': _join,
    'str/join': _join,
    'str/replace': _replace,

    'conj': conj,
    'seq': seq,
    'filter': filter,

    'with-meta': with_meta,
    'meta': meta,
    'atom': types._atom,
    'atom?': types._atom_Q,
    "deref": deref,
    "reset!": reset_BANG,
    "swap!": swap_BANG,

    'js-eval': js_eval,
    '.': js_method_call,

    'set': toSet,
    'disj': _disj,
    'set/union': _union,
    'set/intersection': _intersection,
    'set/symmetric-difference': symmetricDifference,
    'set/difference': _difference
};
