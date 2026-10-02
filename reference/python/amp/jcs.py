"""RFC 8785 JSON Canonicalization, restricted to the AMP value profile.

AMP forbids JSON floating point entirely. Integers must be within the
IEEE-754 safe range (|n| <= 2^53 - 1); larger quantities (token amounts)
are carried as decimal strings. Under that profile RFC 8785 reduces to:
sorted keys (by UTF-16 code units), no insignificant whitespace, and
ECMAScript string escaping.
"""
MAX_SAFE_INT = 2**53 - 1

_SHORT = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}


class CanonicalizationError(ValueError):
    pass


def _str(s: str) -> str:
    try:
        s.encode("utf-8")
    except UnicodeEncodeError as e:  # lone surrogates are not valid I-JSON
        raise CanonicalizationError("string contains lone surrogate") from e
    out = ['"']
    for ch in s:
        if ch in _SHORT:
            out.append(_SHORT[ch])
        elif ord(ch) < 0x20:
            out.append("\\u%04x" % ord(ch))
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _ser(v) -> str:
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float):
        raise CanonicalizationError("floats are forbidden in AMP documents")
    if isinstance(v, int):
        if abs(v) > MAX_SAFE_INT:
            raise CanonicalizationError("integer outside safe range; encode as decimal string")
        return str(v)
    if isinstance(v, str):
        return _str(v)
    if isinstance(v, (list, tuple)):
        return "[" + ",".join(_ser(x) for x in v) + "]"
    if isinstance(v, dict):
        for k in v:
            if not isinstance(k, str):
                raise CanonicalizationError("object keys must be strings")
        keys = sorted(v.keys(), key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(_str(k) + ":" + _ser(v[k]) for k in keys) + "}"
    raise CanonicalizationError(f"unsupported type {type(v).__name__}")


def canonicalize(value) -> bytes:
    return _ser(value).encode("utf-8")
