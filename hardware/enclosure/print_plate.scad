// Одна печатная плита Bambu Lab 256 × 256: обе детали в ориентации для печати.
// Основа — как стоит (носки на столе), крышка — вверх дном (верх на столе).
// Сборка:  openscad -o ../3d-models/qamqor_plate_bambu_256.stl print_plate.scad
translate([0,  52, -0.01]) import("../3d-models/qamqor_base.stl");
translate([0, -52, 90])    rotate([180, 0, 0]) import("../3d-models/qamqor_lid.stl");
% translate([-128, -128, -0.6]) cube([256, 256, 0.5]);   // контур стола, в STL не попадает
