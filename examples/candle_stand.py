# Candle stand, translated from candleStand.scad (build123d algebra mode, mm, Z up)
#
# The OpenSCAD customizer comments (`// [70:large,50:medium]`, `/*[ Group ]*/`)
# are expressed by Studio's @ui decorator on the model function. The signature stays
# plain Python (name, type, default); the decorator adds description, interval and
# choices per parameter name, grouped as the customizer showed them, and checks
# the names against the signature.
from math import cos, sin, radians

from build123d import *
from build123d_studio import Param, show, show_clear, ui
from bd_materials import FinishedMaterial, metals, finishes

ccm = (Align.CENTER, Align.CENTER, Align.MIN)
Mcm = (Align.MAX, Align.CENTER, Align.MIN)
Mcc = (Align.MAX, Align.CENTER, Align.CENTER)


# UI definition
lengths = {"large": 70, "medium": 50, "small": 30}


@ui(
    {
        "Candle Stand": {
            "length": Param(desc="Length of candle stand", choice=lengths, step=0.5),
            "radius": Param(desc="Radius of ring of stand", step=0.1),
        },
        "Candle Holder": {
            "candle_size": Param(desc="Length of candle holder", step=0.1),
            "width": Param(desc="Width of candle holder", step=0.1),
            "hole_size": Param(desc="Size of hole for candle holder", step=0.1),
            "center_sphere_width": Param(desc="Center sphere width", step=0.1),
        },
        "Candle holders": {
            "count": Param(desc="Number of candle holders", interval=(3, 14)),
            "center_candle": Param(desc="Do you want center Candle"),
        },
        "Properties of ring": {
            "height_of_ring": Param(desc="Height of ring", step=0.5),
            "width_of_ring": Param(desc="Width of ring", step=0.5),
        },
        "Properties of support": {
            "height_of_support": Param(desc="Height of support", step=0.5),
            "width_of_support": Param(desc="Width of support", step=0.5),
        },
    }
)
def candle_stand(
    length: float = 40,
    radius: float = 25,
    count: int = 7,
    center_candle: bool = True,
    candle_size: float = 7,
    width: float = 4,
    hole_size: float = 3,
    center_sphere_width: float = 4,
    height_of_support: float = 2,
    width_of_support: float = 3,
    height_of_ring: float = 4,
    width_of_ring: float = 23,
) -> Compound:
    locs = PolarLocations(radius, count)

    stand = Cone(width - 2, 1, length - candle_size / 2, align=ccm)

    holder_block = Cylinder(width, candle_size)
    holder = holder_block - Pos(0, 0, 1) * Cylinder(hole_size, candle_size + 1)

    holders = locs * holder
    if center_candle:
        holders.append(holder)
    else:
        holders.append(Sphere(center_sphere_width))

    bar = Pos(-3.5, 0, 0) * Box(
        radius - 7,
        width_of_support,
        height_of_support,
        align=Mcc,
    )
    supports = locs * bar

    ring_face = (Circle(radius) - Circle(width_of_ring)).face()
    ring = extrude(ring_face, height_of_ring / 2, both=True)
    ring -= locs * holder_block
    ring += holders + supports

    bar = Box(radius, width_of_support, height_of_support, align=Mcm)
    f_size = min(width_of_support, height_of_support) / 3
    bar = fillet(bar.edges(), f_size)

    stand += locs * bar

    top = Pos(0, 0, length)
    candle_holder = stand + top * ring

    candle_holder.material = metals.brass(finish=finishes.brushed())

    return candle_holder.compound()


stand = candle_stand()
show(stand)
