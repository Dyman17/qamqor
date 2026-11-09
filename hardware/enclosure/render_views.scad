// Рендер-превью из готовых STL (сначала собрать stl/*.stl).
view = "assembly";  // assembly | open | base | lid
open_angle = 100;
hinge_y = 40 + 7.5/2 + 0.4; hinge_z = 70;   // как в qamqor_enclosure.scad
module base() color("#303030") import("stl/qamqor_base.stl");
module lid()  color("#262626") import("stl/qamqor_lid.stl");
if (view == "assembly") { base(); lid(); }
if (view == "open") { base(); translate([0, hinge_y, hinge_z]) rotate([-open_angle, 0, 0]) translate([0, -hinge_y, -hinge_z]) lid(); }
if (view == "base") base();
if (view == "lid")  lid();
