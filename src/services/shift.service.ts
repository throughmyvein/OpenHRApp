
import { supabase, isSupabaseConfigured } from './supabase';
import { apiClient } from './api.client';
import { Shift, ShiftOverride } from '../types';

let cachedShifts: Shift[] | null = null;
let cachedOverrides: ShiftOverride[] | null = null;

// Supabase uses snake_case; PB used camelCase for shift fields.
const mapShift = (r: any): Shift => ({
  id: r.id,
  name: r.name,
  startTime: r.start_time,
  endTime: r.end_time,
  lateGracePeriod: r.late_grace_period,
  earlyOutGracePeriod: r.early_out_grace_period,
  earliestCheckIn: r.earliest_check_in,
  autoSessionCloseTime: r.auto_session_close_time,
  workingDays: r.working_days,
scheduleType: r.schedule_type ?? 'WEEKLY',
cycleWorkDays: r.cycle_work_days ?? undefined,
cycleOffDays: r.cycle_off_days ?? undefined,
cycleStartDate: r.cycle_start_date ?? undefined,
  isDefault: r.is_default,
});

export const shiftService = {
  clearCache() {
    cachedShifts = null;
    cachedOverrides = null;
  },

  async getShifts(): Promise<Shift[]> {
    if (cachedShifts) return cachedShifts;
    if (!isSupabaseConfigured()) {
      console.warn('[ShiftService] Supabase not configured');
      return [];
    }
    const orgId = apiClient.getOrganizationId();
    if (!orgId) {
      console.warn('[ShiftService] No organization ID available');
      return [];
    }
    try {
      const { data, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('organization_id', orgId)
        .order('created', { ascending: false })
        .limit(200);
      if (error) throw error;
      cachedShifts = (data ?? []).map(mapShift);
      return cachedShifts;
    } catch (e: any) {
      console.error('[ShiftService] Failed to fetch shifts:', e?.message || e);
      return [];
    }
  },

  async createShift(shift: Partial<Shift>): Promise<Shift> {
    if (!isSupabaseConfigured()) throw new Error('Supabase not configured');
    const orgId = apiClient.getOrganizationId();
    if (!orgId) throw new Error('No organization ID available');

    if (shift.isDefault) await this.clearOtherDefaults();

    const payload = {
  name: shift.name,
  start_time: shift.startTime,
  end_time: shift.endTime,
  late_grace_period: shift.lateGracePeriod ?? 15,
  early_out_grace_period: shift.earlyOutGracePeriod ?? 15,
  earliest_check_in: shift.earliestCheckIn ?? '06:00',
  auto_session_close_time: shift.autoSessionCloseTime ?? '23:59',
  working_days: shift.workingDays ?? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Sunday'],

  schedule_type: shift.scheduleType ?? 'WEEKLY',
  cycle_work_days:
    shift.scheduleType === 'CYCLE'
      ? (shift.cycleWorkDays ?? 2)
      : null,
  cycle_off_days:
    shift.scheduleType === 'CYCLE'
      ? (shift.cycleOffDays ?? 2)
      : null,
  cycle_start_date:
    shift.scheduleType === 'CYCLE' && shift.cycleStartDate
      ? shift.cycleStartDate
      : null,

  is_default: shift.isDefault ?? false,
  organization_id: orgId,
};

    const { data, error } = await supabase.from('shifts').insert(payload).select().single();
    if (error) throw error;
    this.clearCache();
    apiClient.notify();
    return mapShift(data);
  },

  async updateShift(id: string, shift: Partial<Shift>): Promise<void> {
    if (!isSupabaseConfigured()) throw new Error('Supabase not configured');

    const payload: any = {};
    if (shift.name !== undefined)                payload.name = shift.name;
    if (shift.startTime !== undefined)           payload.start_time = shift.startTime;
    if (shift.endTime !== undefined)             payload.end_time = shift.endTime;
    if (shift.lateGracePeriod !== undefined)     payload.late_grace_period = shift.lateGracePeriod;
    if (shift.earlyOutGracePeriod !== undefined) payload.early_out_grace_period = shift.earlyOutGracePeriod;
    if (shift.earliestCheckIn !== undefined)     payload.earliest_check_in = shift.earliestCheckIn;
    if (shift.autoSessionCloseTime !== undefined) payload.auto_session_close_time = shift.autoSessionCloseTime;
    if (shift.workingDays !== undefined)         payload.working_days = shift.workingDays;
if (shift.scheduleType !== undefined)        payload.schedule_type = shift.scheduleType;
if (shift.cycleWorkDays !== undefined)       payload.cycle_work_days = shift.cycleWorkDays;
if (shift.cycleOffDays !== undefined)        payload.cycle_off_days = shift.cycleOffDays;
if (shift.cycleStartDate !== undefined)      payload.cycle_start_date = shift.cycleStartDate;
    if (shift.isDefault !== undefined)           payload.is_default = shift.isDefault;

    if (payload.is_default) await this.clearOtherDefaults(id);

    const { error } = await supabase.from('shifts').update(payload).eq('id', id);
    if (error) throw error;
    this.clearCache();
    apiClient.notify();
  },

  async deleteShift(id: string): Promise<void> {
    if (!isSupabaseConfigured()) throw new Error('Supabase not configured');
    const { error } = await supabase.from('shifts').delete().eq('id', id);
    if (error) throw error;
    this.clearCache();
    apiClient.notify();
    await this.ensureDefaultShift();
  },

  async clearOtherDefaults(exceptId?: string): Promise<void> {
    if (!isSupabaseConfigured()) return;
    const orgId = apiClient.getOrganizationId();
    if (!orgId) return;
    try {
      let query = supabase
        .from('shifts')
        .update({ is_default: false })
        .eq('organization_id', orgId)
        .eq('is_default', true);
      if (exceptId) query = query.neq('id', exceptId);
      const { error } = await query;
      if (error) throw error;
    } catch (e: any) {
      console.error('[ShiftService] Failed to clear other defaults:', e?.message || e);
    }
  },

  async ensureDefaultShift(): Promise<void> {
    if (!isSupabaseConfigured()) return;
    try {
      const shifts = await this.getShifts();
      if (shifts.length === 0) return;
      if (shifts.some(s => s.isDefault)) return;
      const { error } = await supabase
        .from('shifts')
        .update({ is_default: true })
        .eq('id', shifts[0].id);
      if (error) throw error;
      this.clearCache();
    } catch (e: any) {
      console.error('[ShiftService] Failed to ensure default shift:', e?.message || e);
    }
  },

  async getShiftOverrides(): Promise<ShiftOverride[]> {
  if (!isSupabaseConfigured()) return [];
  if (cachedOverrides) return cachedOverrides;

  const orgId = apiClient.getOrganizationId();
  if (!orgId) return [];

  const { data, error } = await supabase
    .from('shift_overrides')
    .select('*')
    .eq('organization_id', orgId)
    .order('start_date', { ascending: true });

  if (error) {
    console.error('[ShiftService] Failed to fetch shift overrides:', error.message);
    return [];
  }

  cachedOverrides = (data || []).map((r: any) => ({
    id: r.id,
    employeeId: r.employee_id,
    shiftId: r.shift_id,
    startDate: r.start_date,
    endDate: r.end_date,
    reason: r.reason || '',
  }));

  return cachedOverrides;
},

async setShiftOverrides(overrides: ShiftOverride[]) {
  if (!isSupabaseConfigured()) return;

  const orgId = apiClient.getOrganizationId();
  if (!orgId) throw new Error('No organization ID available');

  const existing = await this.getShiftOverrides();

  const incomingIds = new Set(
    overrides
      .map(o => o.id)
      .filter(id => id && !id.startsWith('so_'))
  );

  const idsToDelete = existing
    .filter(o => !incomingIds.has(o.id))
    .map(o => o.id);

  if (idsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from('shift_overrides')
      .delete()
      .in('id', idsToDelete);

    if (deleteError) throw deleteError;
  }

  for (const override of overrides) {
    const payload = {
      organization_id: orgId,
      employee_id: override.employeeId,
      shift_id: override.shiftId,
      start_date: override.startDate,
      end_date: override.endDate,
      reason: override.reason || '',
    };

    if (override.id && !override.id.startsWith('so_')) {
      const { error } = await supabase
        .from('shift_overrides')
        .update(payload)
        .eq('id', override.id);

      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('shift_overrides')
        .insert(payload);

      if (error) throw error;
    }
  }

  cachedOverrides = null;
  await this.getShiftOverrides();
  apiClient.notify();
},

  async resolveShiftForEmployee(
    employeeId: string,
    employeeShiftId: string | undefined,
    date?: string
  ): Promise<Shift | null> {
    const shifts = await this.getShifts();
    if (shifts.length === 0) return null;
    const targetDate = date || new Date().toISOString().split('T')[0];

    // 1. Overrides
    const overrides = await this.getShiftOverrides();
    const activeOverride = overrides.find(
      o => o.employeeId === employeeId && targetDate >= o.startDate && targetDate <= o.endDate
    );
    if (activeOverride) {
      const overrideShift = shifts.find(s => s.id === activeOverride.shiftId);
      if (overrideShift) return overrideShift;
    }

    // 2. Employee assignment
    if (employeeShiftId) {
      const assignedShift = shifts.find(s => s.id === employeeShiftId);
      if (assignedShift) return assignedShift;
    }

    // 3. Default
    return shifts.find(s => s.isDefault) || null;
  },
};
