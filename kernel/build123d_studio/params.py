"""The parameter UI of a model function: `@ui` and `Param`.

A model is a function whose parameters are the things a reader may want to
change without editing code - OpenSCAD's customizer, where the widget grammar
lives in comments. Here the signature stays plain Python (name, type, default)
and the decorator adds what the signature cannot say: a group, a description,
a slider interval, a dropdown. Nothing is duplicated - type and default are
read from the signature, never repeated in the Param - and removing the
decorator leaves a function that is exactly as valid as it was.

The spec is the customizer's own shape, groups of parameters::

    @ui({
        "Candle Stand": {
            "length": Param(choice={"large": 70, "small": 30}, desc="Length"),
            "radius": Param(desc="Radius of ring"),
        },
        "count": Param(interval=(3, 14)),   # a Param at the top level is ungrouped
    })

A dict is a group and a Param is a parameter, so the two can be told apart
without a marker and the group name is written once. The group is the pane's
alone - a heading over the rows - so it is not a property of the Param and the
function never sees it; the decorator records it beside the Param.

The spec is the pane: its order is the pane's order, and a parameter it does
not name is not in the pane - the call the pane makes leaves that keyword out
and the function's own default fills it. A parameter with no default has no
such fallback, so leaving one out of the spec is refused when the function is
defined, as is a name the signature does not have. Keying by string is the one
weak point of this form: a parameter renamed in the signature and not in the
spec would otherwise leave a widget silently missing from the pane, and nothing
else would ever say so.

The result is `fn.ui`, read by inspector.ui_models() the way the variable
explorer reads the namespace, and nothing here computes anything.
"""

import inspect
from dataclasses import dataclass
from typing import get_type_hints


@dataclass(frozen=True)
class Param:
    """What the pane shows for one parameter beyond its type and default."""

    desc: str = ""
    # (lo, hi): a slider.
    interval: tuple | None = None
    # label -> value: a dropdown.
    choice: dict | None = None
    # What one click of the number field's buttons, or one notch of the
    # slider, changes the value by.
    step: float = 1


def _flatten(spec):
    """{group: {name: Param}} and {name: Param}, mixed, as {name: (group, Param)}."""
    flat = {}
    for key, value in spec.items():
        if isinstance(value, Param):
            flat[key] = ("", value)
        elif isinstance(value, dict):
            for name, param in value.items():
                if isinstance(param, Param) is False:
                    raise TypeError(f"@ui: {key!r}/{name!r} is not a Param")
                if name in flat:
                    raise TypeError(f"@ui: {name!r} is listed twice")
                flat[name] = (key, param)
        else:
            raise TypeError(f"@ui: {key!r} is neither a group nor a Param")
    return flat


def ui(spec):
    """Attach a UI definition to a model function as `fn.ui`.

    `fn.ui` maps each parameter name the spec lists, in the spec's order, to
    (type, default, group, Param). `spec` maps group names to dicts of
    parameter names to Param, or parameter names to Param directly. A
    parameter with a default may be left out - it keeps its default; one
    without a default may not.
    """
    flat = _flatten(spec)

    def decorate(fn):
        signature = inspect.signature(fn)
        unknown = set(flat) - set(signature.parameters)
        if len(unknown) != 0:
            raise TypeError(f"@ui on {fn.__name__}: no such parameter(s): {sorted(unknown)}")
        required = [
            name
            for name, parameter in signature.parameters.items()
            if parameter.default is inspect.Parameter.empty and name not in flat
        ]
        if len(required) != 0:
            raise TypeError(
                f"@ui on {fn.__name__}: parameter(s) without a default must be listed: {required}"
            )
        hints = get_type_hints(fn)
        fn.ui = {
            name: (hints.get(name), signature.parameters[name].default, group, param)
            for name, (group, param) in flat.items()
        }
        return fn

    return decorate
