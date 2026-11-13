"""Stand-in for the `onnxruntime` package inside Pyodide: forwards to onnxruntime-web.

Only the surface homr uses. Tensors stay on the JS side (the decoder's KV cache
never crosses into Python); `run_sync` needs JSPI.
"""
import js
import numpy as np
from pyodide.ffi import run_sync, to_js


def _tensor(a):
    a = np.ascontiguousarray(a)
    return js.ort.Tensor.new(str(a.dtype), to_js(a.ravel()), to_js(list(a.shape)))


class OrtValue:
    def __init__(self, tensor):
        self.tensor = tensor

    @staticmethod
    def ortvalue_from_numpy(a, *_):
        return OrtValue(_tensor(a))

    def numpy(self):
        t = self.tensor
        return np.asarray(t.data.to_py()).reshape(list(t.dims))


class _Named:
    def __init__(self, name):
        self.name = name


class _IOBinding:
    def __init__(self):
        self.feeds, self.wanted, self.outputs = {}, [], []

    def bind_cpu_input(self, name, a):
        self.feeds[name] = _tensor(a)

    def bind_ortvalue_input(self, name, value):
        self.feeds[name] = value.tensor

    def bind_output(self, name, *_):
        if name not in self.wanted:
            self.wanted.append(name)

    def get_outputs(self):
        return self.outputs


class InferenceSession:
    def __init__(self, path, providers=None, **_):
        self.js = run_sync(js.ortSession(str(path)))

    def get_inputs(self):
        return [_Named(n) for n in self.js.inputNames]

    def get_outputs(self):
        return [_Named(n) for n in self.js.outputNames]

    def get_providers(self):
        return ["CPUExecutionProvider"]

    def io_binding(self):
        return _IOBinding()

    def run_with_iobinding(self, iobinding):
        feeds = to_js(iobinding.feeds, dict_converter=js.Object.fromEntries)
        result = run_sync(self.js.run(feeds))
        iobinding.outputs = [OrtValue(getattr(result, n)) for n in iobinding.wanted]


def get_available_providers():
    return ["CPUExecutionProvider"]


def set_default_logger_severity(_):
    pass


def preload_dlls():
    pass
