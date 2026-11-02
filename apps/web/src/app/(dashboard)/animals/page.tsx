'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiClient } from '../../../lib/api';
import {
  Compass,
  Plus,
  Search,
  Battery,
  MapPin,
  Trees,
  CheckCircle2,
  AlertTriangle,
  Radio,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';

export default function AnimalsPage() {
  const [animals, setAnimals] = useState<any[]>([]);
  const [geofences, setGeofences] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [speciesFilter, setSpeciesFilter] = useState('ALL');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form states
  const [newName, setNewName] = useState('');
  const [newTag, setNewTag] = useState('');
  const [newSpecies, setNewSpecies] = useState('HORSE');
  const [newBreed, setNewBreed] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedGeofenceId, setSelectedGeofenceId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    try {
      const [animalsData, geofencesData, devicesData] = await Promise.all([
        ApiClient.listAnimals(),
        ApiClient.listGeofences(),
        ApiClient.listDevices(),
      ]);
      setAnimals(animalsData);
      setGeofences(geofencesData);
      setDevices(devicesData);
      if (geofencesData.length > 0) setSelectedGeofenceId(geofencesData[0].id);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateAnimal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newTag.trim()) {
      setFormError('Заполните кличку и номер бирки');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await ApiClient.createAnimal({
        name: newName.trim(),
        tagNumber: newTag.trim(),
        species: newSpecies,
        breed: newBreed.trim() || undefined,
        deviceId: selectedDeviceId || undefined,
        activeGeofenceId: selectedGeofenceId || undefined,
      });
      setIsModalOpen(false);
      setNewName('');
      setNewTag('');
      setNewBreed('');
      setSelectedDeviceId('');
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Ошибка создания животного');
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = animals.filter((a) => {
    const matchSearch =
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.tagNumber.toLowerCase().includes(search.toLowerCase());
    const matchSpecies = speciesFilter === 'ALL' || a.species === speciesFilter;
    return matchSearch && matchSpecies;
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Учёт поголовья</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Регистрация скота, контроль смарт-ошейников и статуса выпаса
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-bold shadow-md shadow-emerald-950/10 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Добавить животное</span>
        </button>
      </div>

      {/* Search and Filters Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по кличке или номеру бирки..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-medium"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto text-xs">
          {['ALL', 'HORSE', 'CAMEL', 'CATTLE', 'SHEEP'].map((sp) => (
            <button
              key={sp}
              onClick={() => setSpeciesFilter(sp)}
              className={`px-3 py-1.5 rounded-xl font-bold shrink-0 transition-colors ${
                speciesFilter === sp
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {sp === 'ALL' ? 'Все' : sp === 'HORSE' ? '🐎 Жылқы' : sp === 'CAMEL' ? '🐫 Түйе' : sp === 'CATTLE' ? '🐄 Сиыр' : '🐑 Қой'}
            </button>
          ))}
        </div>
      </div>

      {/* Livestock Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase font-bold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">Кличка / Животное</th>
                <th className="py-3 px-4">Вид и порода</th>
                <th className="py-3 px-4">Номер бирки</th>
                <th className="py-3 px-4">Смарт-ошейник</th>
                <th className="py-3 px-4">Батарея</th>
                <th className="py-3 px-4">Пастбище</th>
                <th className="py-3 px-4">Статус геозоны</th>
                <th className="py-3 px-4 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((animal) => {
                const isBreach = animal.isOutsideGeofence;
                const battery = animal.device?.battery ?? 100;

                return (
                  <tr
                    key={animal.id}
                    className={`hover:bg-slate-50/80 transition-colors ${isBreach ? 'bg-red-50/40' : ''}`}
                  >
                    <td className="py-3.5 px-4 font-bold text-slate-900 flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${
                          isBreach ? 'bg-red-600 text-white' : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {animal.name[0]}
                      </div>
                      <div>
                        <div>{animal.name}</div>
                        <div className="text-[11px] text-slate-400 font-normal">
                          {animal.gender === 'MALE' ? 'Еркек' : animal.gender === 'FEMALE' ? 'Ұрғашы' : 'Жынысы белгісіз'}
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-xs">
                      <div className="font-semibold text-slate-800">{animal.species}</div>
                      <div className="text-slate-400 text-[11px]">{animal.breed || 'Қазақы тұқым'}</div>
                    </td>

                    <td className="py-3.5 px-4 text-xs font-mono font-bold text-slate-700">
                      {animal.tagNumber}
                    </td>

                    <td className="py-3.5 px-4 text-xs">
                      {animal.device ? (
                        <div className="flex items-center gap-1.5">
                          <Radio className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="font-mono font-bold text-slate-800 px-2 py-0.5 rounded bg-slate-100 border">
                            {animal.device.deviceId}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Нет ошейника</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-14 h-2 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className={`h-full ${
                              battery <= 15 ? 'bg-red-500' : battery <= 30 ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${battery}%` }}
                          ></div>
                        </div>
                        <span className={`text-[11px] font-bold ${battery <= 15 ? 'text-red-600' : 'text-slate-600'}`}>
                          {battery}%
                        </span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-xs font-medium text-slate-700">
                      {animal.activeGeofence ? (
                        <span className="inline-flex items-center gap-1 text-emerald-800">
                          <Trees className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{animal.activeGeofence.name}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">Не назначено</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      {isBreach ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black bg-red-100 text-red-700 border border-red-300">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                          ВНЕ ПАСТБИЩА
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          В загоне
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <Link
                        href={`/map?animalId=${animal.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                      >
                        <MapPin className="w-3.5 h-3.5 text-emerald-700" />
                        <span>На карте</span>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Animal Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-base text-slate-900">Регистрация нового животного</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateAnimal} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Кличка или имя скота *</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Например: Қарагер, Ақтабан"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Номер ушной бирки (Tag ID) *</label>
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="KZ-HORSE-005"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 font-mono font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Вид животного</label>
                  <select
                    value={newSpecies}
                    onChange={(e) => setNewSpecies(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium outline-none"
                  >
                    <option value="HORSE">Жылқы (Лошадь)</option>
                    <option value="CAMEL">Түйе (Верблюд)</option>
                    <option value="CATTLE">Сиыр (КРС)</option>
                    <option value="SHEEP">Қой (Овца)</option>
                    <option value="GOAT">Ешкі (Коза)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Порода (опционально)</label>
                  <input
                    type="text"
                    value={newBreed}
                    onChange={(e) => setNewBreed(e.target.value)}
                    placeholder="Қазақы жабы"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Привязать смарт-ошейник</label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium outline-none font-mono"
                >
                  <option value="">Без ошейника (пока не привязан)</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.deviceId}>
                      {d.deviceId} (Батарея: {d.battery}%)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Назначить пастбище</label>
                <select
                  value={selectedGeofenceId}
                  onChange={(e) => setSelectedGeofenceId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium outline-none"
                >
                  {geofences.map((gf) => (
                    <option key={gf.id} value={gf.id}>
                      {gf.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Сохранение...' : 'Зарегистрировать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

