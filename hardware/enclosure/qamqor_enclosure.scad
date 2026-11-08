// =====================================================================
//  Qamqor — корпус смарт-ошейника (прототип под FDM-печать), v0.5
//  По ТЗ владельца от 2026-11-08 (текст в README.md).
//  OpenSCAD 2021.01.
//
//  Оси:  X — поперёк шеи (210 с ушками, длина:высота = 7:3), Y — вдоль шеи (80), Z — высота.
//        +Y — к голове, поэтому левый бок животного — это −X.
//
//  Части:
//    base — нижняя основа (Z 0..70): арка под шею, ушки ремня,
//           динамик слева, отверстие Ø11 справа, отверстия к коже, USB-C
//    lid  — верхняя крышка 20 мм (Z 70..90): солнечная панель, окно GPS
//  Внутренние стойки под электронику по ТЗ «в дальнейшем», здесь их нет.
//
//  Выбор части:  openscad -D 'part="lid"' -o lid.stl qamqor_enclosure.scad
//  «ДОПУЩЕНИЕ» — значение не задано владельцем (см. README.md).
// =====================================================================

part = "assembly"; // base | lid | assembly | open | components | check_base | check_lid | check_parts | check_open

/* ---------- Габариты (ТЗ) ---------- */
L  = 80;          // ширина вдоль шеи
H  = 90;          // максимальная высота (по краям)
ratio = 7/3;      // длина : высота = 7 : 3 (владелец)
W_total = H*ratio;  // 210 с ушками
center_h = 70;    // минимальная высота в области изгиба
lid_t = 20;       // крышка ~2 см, основа ~7 см
wall = 2;

/* ---------- Форма (обтекаемость) ---------- */
r_y    = 7;       // скругление кромок передней/задней граней
r_top  = 15;      // скругление «верх — бок»
toe_r  = 10;      // скругление нижних «носков» (безопасность животного)
arch_h = H - center_h;   // 20

/* ---------- Ушки ремня (ТЗ: мостики с отверстием внизу по краям) ---------- */
lug_len   = 70;   // вдоль Y: «чуть уже ширины» 80 (владелец)
lug_post  = 8;    // стойки → щель 54 мм
lug_slot  = 3.5;  // щель под толщину стропы до ~3 мм (ДОПУЩЕНИЕ)
lug_bar   = 4.5;
lug_h     = 12;
lug_z0    = H/6 - lug_h/2;   // центр на 1/6 высоты над нижней точкой (владелец)
lug_r     = 2;
lug_out   = lug_slot + lug_bar;   // вынос за бок 8 мм
Wb = W_total - 2*lug_out;          // 194 — корпус без ушек
// Радиус арки: арка касается носков R10 без угла
neck_R = (pow(Wb/2 - toe_r, 2) + pow(arch_h - toe_r, 2) - toe_r*toe_r) / (2*arch_h);

/* ---------- Разъём и уплотнение ---------- */
seam_z    = H - lid_t;   // 70
fl_bot_w  = 6;  fl_bot_h = 5;
fl_top_w  = 5;  fl_top_h = 2.5;
groove_in = 2;  groove_w = 2.2; groove_d = 1.8;   // паз под шнур Ø2 (ДОПУЩЕНИЕ)

/* ---------- Крепёж: 4 × M3 сверху через крышку ---------- */
screw_x = Wb/2 - 6.5; screw_y = 28;
SCREWS = [];   // винты заменены петлёй и защёлками (владелец); вернуть список, если нужен винтовой вариант
boss_d   = 9.6;
screw_d  = 3.4;
cb_d     = 6.5;   // цековка под голову M3 DIN 912
insert_d = 4.0;   // вплавляемая вставка M3×5.7 (ДОПУЩЕНИЕ)
insert_depth = 7;

/* ---------- Верх: солнечная панель и GPS (ТЗ) ---------- */
panel = 60;        // панель 60×60
panel_seat = 55;   // посадочное место 55×55: ступенька-полка под край панели (владелец, 2026-11-08)
panel_t = 3;       // ДОПУЩЕНИЕ: толщина панели
panel_clear = 0.3;
seat_step = 1.0;   // углубление 55×55 под клей/герметик
panel_cx = -20;    // ниша смещена влево, справа окно GPS
wire_d = 3.0;      // выходы проводов панели (2–3 мм, владелец)
wire_pts = [[panel_cx - 10, 0], [panel_cx + 10, 0]];
gps_win = 25;      // окно GPS 25×25 (ТЗ)
gps_cx = 30;

/* ---------- Бока (ТЗ) ---------- */
side_z = 42;       // центр отверстий по высоте
spk_open = 40;     // слева Ø40: решётка динамика из отверстий Ø2 (владелец, 2026-11-08)
grille_hole = 2.0; grille_pitch = 3.6;
right_open = 11;   // справа одно отверстие Ø11

/* ---------- Низ, к шее (ТЗ) ---------- */
vib_d = 11;                 // вибромотор Ø11
pulse_win = [20.5, 15.3];   // датчик пульса 20,5×15,3
elec_d = 5;                 // 2 электрода Ø5
vib_pos   = [0, 22];        // ДОПУЩЕНИЕ: раскладка на вершине арки
pulse_pos = [0, 0];
elec_pos  = [[-20, -20], [20, -20]];

/* ---------- Зарядка (владелец): отверстие сзади, у конца ESP32 ---------- */
// ESP32 DevKit V1 стоит разъёмом USB к задней стенке, отверстие — напротив разъёма (владелец)
esp32  = [-30, L/2 - wall - 1 - 51/2, 28, 51, 13];   // [cx, cy, sx, sy, sz]; ДОПУЩЕНИЕ: высота 13 с пинами
esp32_z0 = 45;                                       // низ платы с пинами (ДОПУЩЕНИЕ)
usb_z_on_board = 11.5;                               // ДОПУЩЕНИЕ: центр разъёма над низом пинов
usb = [14, 9];     // окно под корпус штекера, кабель заходит до разъёма (владелец: «чуть побольше»)
usb_pos = [esp32[0], esp32_z0 + usb_z_on_board];     // x, z на задней грани (+Y)

/* ---------- Компоненты для проверки свободного места (ДОПУЩЕНИЯ) ---------- */
batt_d = 21.5; batt_len = 70.5;       // 5000 мА·ч — элемент 21700
lte    = [ 20, -20, 40, 30, 8];       // 4G-модуль, модель не выбрана
gps    = [gps_cx, 0, 35, 25, 10];     // GPS с патч-антенной сверху
spk    = [40, 6];                     // динамик Ø40×6
buzz   = [12, 9.5];                   // баззер Ø12×9.5

/* ---------- Петля крышки (задняя грань, ось вдоль X) ---------- */
pin_d   = 3.0;        // штырь: стальной пруток Ø3 или шпилька M3, длина ≥ 165 (ДОПУЩЕНИЕ)
pin_hole = pin_d + 0.3;
knuckle_d = 7.5;      // проушина
hinge_x0 = -80; hinge_x1 = 80;   // пролёт петли
n_knuckle = 5;        // чётные — основа, нечётные — крышка
knuckle_gap = 0.5;
hinge_y = L/2 + knuckle_d/2 + 0.4;   // ось снаружи задней грани
hinge_z = H - lid_t;                 // ось на уровне шва

/* ---------- Защёлки (передняя грань) ---------- */
LATCH_X = [-55, 55];
latch_w = 16;         // ширина крючка
arm_t   = 2;          // толщина упругой лапки
arm_len = 14;         // длина лапки: деформация ≈1.5·t·δ/L² ≈ 1.8 % (PETG/ASA)
latch_d = 1.2;        // зацеп
arm_gap = 1.5;        // зазор лапки от грани (место под выступ)
open_angle = 95;      // для проверки part="check_open"

$fn = 48;

// =====================================================================
//  Профиль XZ
// =====================================================================
Cn = [0, arch_h - neck_R];
Ct = [Wb/2 - toe_r, toe_r];
function unit(v) = v / norm(v);
uT = unit(Ct - Cn);
phi_T = atan2(uT[1], uT[0]);
a_toe = atan2(-uT[1], -uT[0]);
n_arch = 24; n_toe = 10;
function arc(c, r, a0, a1, n) = [for (k=[0:n]) c + r*[cos(a0 + (a1-a0)*k/n), sin(a0 + (a1-a0)*k/n)]];

function fillet_corner(A, P, B, r, fn) =
  r <= 0 ? [P] :
  let(u = unit(A-P), v = unit(B-P), ang = acos(max(-1, min(1, u*v))),
      t = r / tan(ang/2), C = P + unit(u+v) * (r / sin(ang/2)),
      T1 = P + u*t, T2 = P + v*t,
      a1 = atan2(T1[1]-C[1], T1[0]-C[0]), a2 = atan2(T2[1]-C[1], T2[0]-C[0]),
      d0 = a2 - a1, da = d0 > 180 ? d0 - 360 : (d0 < -180 ? d0 + 360 : d0),
      n = max(2, ceil(abs(da)/90*fn)))
  [for (k=[0:n]) C + r*[cos(a1 + da*k/n), sin(a1 + da*k/n)]];
function round_poly(pts, radii, fn=8) =
  let(N=len(pts)) [for (i=[0:N-1]) each fillet_corner(pts[(i-1+N)%N], pts[i], pts[(i+1)%N], radii[i], fn)];
function offset_pts(pts, d) =
  let(N=len(pts)) [for (i=[0:N-1]) let(t = pts[(i+1)%N] - pts[(i-1+N)%N], n = unit([t[1], -t[0]])) pts[i] - d*n];

arch_pts = arc(Cn, neck_R, 180 - phi_T, phi_T, n_arch);
toeR_pts = arc(Ct, toe_r, a_toe, 0, n_toe);
toeL_pts = [for (i=[len(toeR_pts)-1:-1:0]) [-toeR_pts[i][0], toeR_pts[i][1]]];
RAW = concat(arch_pts, [for (i=[1:len(toeR_pts)-1]) toeR_pts[i]], [[Wb/2, H], [-Wb/2, H]],
             [for (i=[0:len(toeL_pts)-2]) toeL_pts[i]]);
RAD = concat([for (p=arch_pts) 0], [for (i=[1:len(toeR_pts)-1]) 0], [r_top, r_top], [for (i=[0:len(toeL_pts)-2]) 0]);
PROFILE = round_poly(RAW, RAD, 10);

function b(x) = abs(x) <= neck_R*cos(phi_T) ? Cn[1] + sqrt(neck_R*neck_R - x*x) : 0;
floor_apex = arch_h + wall;

function stations(Lb, rb, n) = concat(
  [for (k=[0:n]) let(th = 90 - 90*k/n) [-Lb/2 + rb*(1-sin(th)), rb*(1-cos(th))]],
  [for (k=[0:n]) let(th = 90*k/n)      [ Lb/2 - rb*(1-sin(th)), rb*(1-cos(th))]]);
module rounded_extrusion(pts, Lb, rb, d0, n=8) {
  st = stations(Lb, rb, n); S = len(st); N = len(pts);
  P3 = [for (s=st) let(o = offset_pts(pts, d0 + s[1])) for (p=o) [p[0], s[0], p[1]]];
  F = concat([[for (i=[N-1:-1:0]) i]], [[for (i=[0:N-1]) (S-1)*N + i]],
    [for (s=[0:S-2]) for (i=[0:N-1]) each [
      [s*N+i, s*N+(i+1)%N, (s+1)*N+(i+1)%N], [s*N+i, (s+1)*N+(i+1)%N, (s+1)*N+i]]]);
  polyhedron(P3, F, convexity=10);
}

module outer_solid() rounded_extrusion(PROFILE, L, r_y, 0);
module inner_solid() rounded_extrusion(PROFILE, L - 2*wall, r_y - wall, wall);
module shell() difference() { outer_solid(); inner_solid(); }
module plan2d() offset(r=r_y) square([Wb - 2*r_y, L - 2*r_y], center=true);
module plan_ring(o1, o2) linear_extrude(height=300, center=true)
  difference() { offset(delta=-o1) plan2d(); offset(delta=-o2) plan2d(); }
module zslab(z0, z1) translate([-200, -200, z0]) cube([400, 400, z1 - z0]);

// =====================================================================
//  Элементы
// =====================================================================
module rbox(p0, p1, r) hull() for (x=[p0[0]+r, p1[0]-r]) for (y=[p0[1]+r, p1[1]-r]) for (z=[p0[2]+r, p1[2]-r])
  translate([x, y, z]) sphere(r=r, $fn=16);
module lugs() for (sx=[-1,1]) mirror([sx < 0 ? 1 : 0, 0, 0]) {
  x0 = Wb/2 - 3; x1 = Wb/2 + lug_out; z0 = lug_z0; z1 = lug_z0 + lug_h;
  for (sy=[-1,1]) mirror([0, sy < 0 ? 1 : 0, 0]) rbox([x0, lug_len/2 - lug_post, z0], [x1, lug_len/2, z1], lug_r);
  rbox([Wb/2 + lug_slot, -lug_len/2, z0], [x1, lug_len/2, z1], lug_r);
}

module flange(w, z0, h, up) {   // фланец с фаской 45° в сторону от шва
  intersection() { plan_ring(0, w);   zslab(up ? z0 : z0 - h, up ? z0 + h : z0); }
  intersection() { plan_ring(0, w-1); zslab(up ? z0 + h : z0 - h - 1, up ? z0 + h + 1 : z0 - h); }
  intersection() { plan_ring(0, w-2); zslab(up ? z0 + h + 1 : z0 - h - 2, up ? z0 + h + 2 : z0 - h - 1); }
}
module gasket_groove() intersection() { plan_ring(groove_in, groove_in + groove_w); zslab(seam_z - groove_d, seam_z + 1); }

boss_len = insert_depth + 5;
module base_boss(s) translate([s[0], s[1], seam_z - boss_len]) {   // короткая, у шва, снизу конус 45°
  cylinder(d=boss_d, h=boss_len + 0.01);
  translate([0, 0, -boss_d/2]) cylinder(d1=0, d2=boss_d, h=boss_d/2 + 0.01);
}

module grille_left() for (i=[-7:7]) for (j=[-7:7])
  let(yy = i*grille_pitch + abs(j%2)*grille_pitch/2, zz = j*grille_pitch*0.866)
  if (yy*yy + zz*zz <= pow(spk_open/2 - grille_hole/2, 2))
    translate([-Wb/2 + wall/2, yy, side_z + zz]) rotate([0,90,0]) cylinder(d=grille_hole, h=wall + 6, center=true, $fn=10);
module hole_right() translate([Wb/2 - wall/2, 0, side_z]) rotate([0,90,0]) cylinder(d=right_open, h=wall + 6, center=true, $fn=40);
module thru(p) translate([p[0], p[1], -10]) linear_extrude(height=b(p[0]) + 10 + wall + 3) children();
module bottom_holes() {
  thru(vib_pos) circle(d=vib_d, $fn=40);
  thru(pulse_pos) offset(r=1) square([pulse_win[0] - 2, pulse_win[1] - 2], center=true);
  for (p=elec_pos) thru(p) circle(d=elec_d, $fn=24);
}
// ---------- петля ----------
seg_len = (hinge_x1 - hinge_x0 - (n_knuckle - 1)*knuckle_gap) / n_knuckle;
function seg_x(i) = hinge_x0 + i*(seg_len + knuckle_gap);
module knuckle(i, strip_z0, strip_z1) translate([seg_x(i), 0, 0]) hull() {
  translate([0, hinge_y, hinge_z]) rotate([0,90,0]) cylinder(d=knuckle_d, h=seg_len, $fn=40);
  translate([0, L/2 - 1, strip_z0]) cube([seg_len, 1.1, strip_z1 - strip_z0]);   // косынка 45° к грани
}
// косынки обрезаны по шву, чтобы не заходить в стенку другой детали
module base_hinge() difference() { for (i=[0:2:n_knuckle-1]) knuckle(i, hinge_z - 8, hinge_z);
  translate([-200, -200, hinge_z]) cube([400, 200 + L/2 + 0.05, 50]); }
module lid_hinge()  difference() { for (i=[1:2:n_knuckle-1]) knuckle(i, hinge_z, hinge_z + 8);
  translate([-200, -200, hinge_z - 50]) cube([400, 200 + L/2 + 0.05, 50]); }
module pin_hole_cut() translate([hinge_x0 - 5, hinge_y, hinge_z]) rotate([0,90,0]) cylinder(d=pin_hole, h=hinge_x1 - hinge_x0 + 10, $fn=24);

// ---------- защёлки ----------
arm_y1 = -L/2 - arm_gap;          // внутренняя грань лапки
arm_y0 = arm_y1 - arm_t;
lip_z0 = hinge_z - arm_len;       // низ лапки
module latch_hooks() for (x=LATCH_X) translate([x - latch_w/2, 0, 0]) {
  hull() {                                                       // корень с косынкой к крышке
    translate([0, arm_y0, hinge_z]) cube([latch_w, -arm_y0 - L/2 + 1, 3]);
    translate([0, -L/2 - 0.1, hinge_z]) cube([latch_w, 1.1, 8]);
  }
  translate([0, arm_y0, lip_z0]) cube([latch_w, arm_t, arm_len + 0.1]);  // лапка
  hull() {                                                       // зуб: сверху плоский, снизу скос
    translate([0, arm_y1 - 0.01, lip_z0 + 1.5]) cube([latch_w, (-L/2 - 0.3) - arm_y1 + 0.01, 0.01]);
    translate([0, arm_y1 - 0.01, lip_z0]) cube([latch_w, 0.01, 0.01]);
  }
  hull() {                                                       // язычок для пальца, скошен
    translate([0, arm_y0 - 3, lip_z0]) cube([latch_w, 3, 0.8]);
    translate([0, arm_y0, lip_z0]) cube([latch_w, 0.01, 4]);
  }
}
module latch_catches() for (x=LATCH_X) translate([x - latch_w/2 + 1, 0, 0]) hull() {   // выступ на основе
  translate([0, -L/2 - latch_d, lip_z0 + 1.6]) cube([latch_w - 2, latch_d + 1, 0.01]);
  translate([0, -L/2 - 0.01, lip_z0 + 1.6 + 3]) cube([latch_w - 2, 1.01, 0.01]);
  translate([0, -L/2 - latch_d, lip_z0 + 1.6]) cube([latch_w - 2, 0.01, 0.6]);
}

module usb_cut() translate([usb_pos[0], L/2 - wall/2, usb_pos[1]]) rotate([90,0,0])
  linear_extrude(height=wall + 6, center=true) hull() for (s=[-1,1]) translate([s*(usb[0] - usb[1])/2, 0]) circle(d=usb[1], $fn=24);

pocket_d = panel_t + 0.5;                // заподлицо + клей
pocket_z0 = H - pocket_d;
lid_floor_z0 = pocket_z0 - seat_step - wall;
module panel_pocket() {
  translate([panel_cx, 0, pocket_z0]) linear_extrude(height=pocket_d + 5)
    offset(r=1) square(panel + 2*panel_clear - 2, center=true);
  translate([panel_cx, 0, pocket_z0 - seat_step]) linear_extrude(height=seat_step + 0.1)
    offset(r=1) square(panel_seat - 2, center=true);
}
module pocket_floor_block() translate([panel_cx, 0, lid_floor_z0 + (H - lid_floor_z0)/2])
  cube([panel + 4, panel + 4, H - lid_floor_z0], center=true);
module wire_holes() for (p=wire_pts) translate([p[0], p[1], lid_floor_z0 - 1]) cylinder(d=wire_d, h=wall + seat_step + 3, $fn=24);
module gps_window() translate([gps_cx, 0, H - 10]) linear_extrude(height=20) offset(r=1) square(gps_win - 2, center=true);

// =====================================================================
//  Детали
// =====================================================================
module base_part() {
  difference() {
    union() {
      intersection() {
        union() {
          shell();
          intersection() { outer_solid(); union() { flange(fl_bot_w, seam_z, fl_bot_h, false); for (s=SCREWS) base_boss(s); } }
        }
        zslab(-50, seam_z);
      }
      lugs();
      base_hinge();
      latch_catches();
    }
    pin_hole_cut();
    gasket_groove();
    for (s=SCREWS) translate([s[0], s[1], seam_z - insert_depth]) cylinder(d=insert_d, h=insert_depth + 1, $fn=24);
    grille_left();
    hole_right();
    bottom_holes();
    usb_cut();
  }
}

module lid_part() {
  difference() {
   union() {
    lid_hinge();
    latch_hooks();
    intersection() {
      union() {
        shell();
        intersection() {
          outer_solid();
          union() {
            flange(fl_top_w, seam_z, fl_top_h, true);
            pocket_floor_block();
            for (s=SCREWS) translate([s[0], s[1], 0]) cylinder(d=boss_d, h=H + 5);
          }
        }
      }
      zslab(seam_z, H + 50);
    }
   }
    pin_hole_cut();
    panel_pocket();
    wire_holes();
    gps_window();
    for (s=SCREWS) translate([s[0], s[1], 0]) {
      cylinder(d=screw_d, h=H + 10, $fn=24);
      translate([0, 0, H - 6]) cylinder(d=cb_d, h=20, $fn=32);   // цековка на скруглении
    }
  }
}

// =====================================================================
//  Компоненты: только объёмы для проверки, что всё помещается
// =====================================================================
module box(c, z0) translate([c[0] - c[2]/2, c[1] - c[3]/2, z0]) cube([c[2], c[3], c[4]]);
module components() {
  color("orange")    translate([0, 0, floor_apex + batt_d/2 + 1.0]) rotate([90,0,0]) cylinder(d=batt_d, h=batt_len, center=true);
  color("royalblue") box(esp32, esp32_z0);
  color("firebrick") box(lte, 48);
  color("seagreen")  box(gps, H - wall - 0.5 - gps[4]);
  color("midnightblue") translate([panel_cx, 0, pocket_z0 + 0.5]) linear_extrude(height=panel_t) square(panel, center=true);
  color("dimgray")   translate([-Wb/2 + wall + 0.5 + spk[1]/2, 0, side_z]) rotate([0,90,0]) cylinder(d=spk[0], h=spk[1], center=true);
  color("dimgray")   translate([ Wb/2 - wall - 0.5 - buzz[1]/2, 0, side_z]) rotate([0,90,0]) cylinder(d=buzz[0], h=buzz[1], center=true);
}
module strap_ghost() color("black", 0.7) for (sx=[-1,1]) mirror([sx < 0 ? 1 : 0, 0, 0]) {
  zt = lug_z0 + lug_h; w = lug_len - 2*lug_post - 2;
  translate([Wb/2 + 0.6, -w/2, -25]) cube([2, w, zt + 25 + 1.5]);
  translate([Wb/2 + 0.6, -w/2, zt + 0.2]) cube([lug_out + 1.5, w, 2]);
  translate([Wb/2 + lug_out + 0.2, -w/2, -25]) cube([2, w, zt + 25 + 2.2]);
}

// =====================================================================
if (part == "base")       base_part();
if (part == "lid")        lid_part();
if (part == "components") components();
if (part == "assembly")   { color("#2b2b2b") lid_part(); color("#333") base_part(); components(); strap_ghost(); }
if (part == "check_base")  intersection() { base_part(); components(); }
if (part == "check_lid")   intersection() { lid_part();  components(); }
module lid_opened(a) translate([0, hinge_y, hinge_z]) rotate([-a, 0, 0]) translate([0, -hinge_y, -hinge_z]) lid_part();
if (part == "open")        { color("#2b2b2b") lid_opened(open_angle); color("#333") base_part(); }
if (part == "check_open")  intersection() { lid_opened(open_angle); base_part(); }
if (part == "check_parts") intersection() { translate([0, 0, 0.01]) lid_part(); base_part(); }

echo(str("neck_R=", neck_R, "  tangent x=", neck_R*cos(phi_T), "  b(20)=", b(20), "  b(25)=", b(25)));
