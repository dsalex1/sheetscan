"""Stand-in for the `onnxruntime` package inside Pyodide: forwards to onnxruntime-web.

Only the surface homr uses. The JavaScript side (ort.js) offers ortNames(path) and
ortRun(path, feeds, wanted); it answers with a promise where WebAssembly JSPI lets
Python wait for one, and at once where the call blocks instead (see omr.worker.js).
Outputs named "cache_out..." stay on the JavaScript side (the decoder's cache, which
Python only hands back in the next step); an OrtValue for one is just its name.
"""
import js
import numpy as np
from pyodide.ffi import run_sync, to_js


def _call(answer):
    return run_sync(answer) if hasattr(answer, "then") else answer


class OrtValue:
    def __init__(self, array=None, kept=None):
        self.array, self.kept = array, kept

    @staticmethod
    def ortvalue_from_numpy(a, *_):
        return OrtValue(np.ascontiguousarray(a))

    def numpy(self):
        return self.array


class _Named:
    def __init__(self, name):
        self.name = name


class _IOBinding:
    def __init__(self):
        self.feeds, self.wanted, self.outputs = {}, [], []

    def bind_cpu_input(self, name, a):
        self.feeds[name] = OrtValue(np.ascontiguousarray(a))

    def bind_ortvalue_input(self, name, value):
        self.feeds[name] = value

    def bind_output(self, name, *_):
        if name not in self.wanted:
            self.wanted.append(name)

    def get_outputs(self):
        return self.outputs


class InferenceSession:
    def __init__(self, path, providers=None, **_):
        self.path = str(path)
        names = _call(js.ortNames(self.path))
        self.inputs, self.outputs = list(names.inputs), list(names.outputs)

    def get_inputs(self):
        return [_Named(n) for n in self.inputs]

    def get_outputs(self):
        return [_Named(n) for n in self.outputs]

    def get_providers(self):
        return ["CPUExecutionProvider"]

    def io_binding(self):
        return _IOBinding()

    def run_with_iobinding(self, iobinding):
        feeds = {
            name: {"keep": value.kept} if value.kept else
            {"type": str(value.array.dtype), "dims": list(value.array.shape), "data": value.array.ravel()}
            for name, value in iobinding.feeds.items()
        }
        to_object = js.Object.fromEntries
        result = _call(js.ortRun(self.path, to_js(feeds, dict_converter=to_object), to_js(iobinding.wanted)))
        iobinding.outputs = [
            OrtValue(kept=name) if name.startswith("cache_out") else OrtValue(_array(getattr(result, name)))
            for name in iobinding.wanted
        ]


def _array(tensor):
    return np.asarray(tensor.data.to_py()).reshape(list(tensor.dims))


def get_available_providers():
    return ["CPUExecutionProvider"]


def set_default_logger_severity(_):
    pass


def preload_dlls():
    pass
