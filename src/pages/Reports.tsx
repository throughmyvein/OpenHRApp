
import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  FileText, Calendar, Clock, RefreshCw, User as UserIcon, Search, FileSpreadsheet, FileDown, MapPin,
  Activity, AlertCircle, HelpCircle, CheckCircle2, CheckCircle, Settings2, Mail, CheckSquare, Square, Layout,
  TrendingUp, CalendarDays, Users, PieChart
} from 'lucide-react';
import { hrService } from '../services/hrService';
import { emailService } from '../services/emailService';
import { organizationService } from '../services/organization.service';
import { User, Employee, Attendance, LeaveRequest, AppConfig, Holiday, Shift, EmployeeAttendanceSummary } from '../types';
import { consolidateAttendance, getDateRangeFromPreset, calculateEmployeeSummaries } from '../utils/attendanceUtils';
import HelpButton from '../components/onboarding/HelpButton';
import { useToast } from '../context/ToastContext';


const getScaledLogoDims = (dataUrl: string, maxSize: number): Promise<{ w: number; h: number }> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(maxSize / img.naturalWidth, maxSize / img.naturalHeight);
      resolve({ w: img.naturalWidth * ratio, h: img.naturalHeight * ratio });
    };
    img.onerror = () => resolve({ w: maxSize, h: maxSize });
    img.src = dataUrl;
  });

interface ReportsProps {
  user: User;
}

const Reports: React.FC<ReportsProps> = ({ user }) => {
  const { showToast } = useToast();
  const [reportType, setReportType] = useState('ATTENDANCE');
  const [periodPreset, setPeriodPreset] = useState<string>('THIS_MONTH');
  
  // Data States
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [dbDepartments, setDbDepartments] = useState<string[]>([]);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftOverrides, setShiftOverrides] = useState<any[]>([]);

  // Log State
  const [emailLogs, setEmailLogs] = useState<any[]>([]);
  const [isHookMissing, setIsHookMissing] = useState(false);
  
  // Filter States
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [employeeFilter, setEmployeeFilter] = useState('All Employees');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Recipient State
  const [customRecipients, setCustomRecipients] = useState('');

  // Org Info for PDF header
  const [orgInfo, setOrgInfo] = useState<{ name: string; address: string; logoDataUrl: string | null }>({ name: '', address: '', logoDataUrl: null });

  // UI States
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [isEmailing, setIsEmailing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [enabledColumns, setEnabledColumns] = useState<Record<string, boolean>>({
    'Employee_ID': true, 'Name': true, 'Date': true, 'Status_Type': true,
    'Check_In': true, 'Check_Out': true, 'Location': true, 'Latitude': true, 'Longitude': true, 'Remarks': true
  });

  const columnOptions = [
    { key: 'Employee_ID', label: 'Employee ID', icon: UserIcon },
    { key: 'Name', label: 'Full Name', icon: Layout },
    { key: 'Date', label: 'Entry Date', icon: Calendar },
    { key: 'Status_Type', label: 'Status', icon: CheckCircle2 },
    { key: 'Check_In', label: 'Clock In', icon: Clock },
    { key: 'Check_Out', label: 'Clock Out', icon: Clock },
    { key: 'Location', label: 'GPS Address', icon: MapPin },
    { key: 'Latitude', label: 'Latitude', icon: Search },
    { key: 'Longitude', label: 'Longitude', icon: Search },
    { key: 'Remarks', label: 'Notes', icon: FileText },
  ];

  const fetchLogs = async () => {
    try {
      const logs = await hrService.getReportQueueLog();
      setEmailLogs(logs);
      const now = new Date();
      const recentPending = logs.some(l => {
        const created = new Date(l.created);
        const diffSeconds = (now.getTime() - created.getTime()) / 1000;
        return l.status === 'PENDING' && diffSeconds > 10;
      });
      setIsHookMissing(recentPending);
    } catch(e) { console.warn("Failed to fetch logs"); }
  };

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        // Reports page needs a wide window (quarterly/annual summaries).
        // Default service window is 30d; override to ~1 year here.
        const yearAgo = new Date();
        yearAgo.setDate(yearAgo.getDate() - 365);
        const sinceYearAgo = yearAgo.toISOString().split('T')[0];

        const [emps, atts, lvs, depts, config, hols, shiftsList, overridesList] = await Promise.all([
          hrService.getEmployees(),
          hrService.getAttendance({ since: sinceYearAgo, maxRows: 10000 }),
          hrService.getLeaves(),
          hrService.getDepartments(),
          hrService.getConfig(),
          hrService.getHolidays(),
          hrService.getShifts(),
          hrService.getShiftOverrides()
        ]);
        setEmployees(emps);
        setAttendance(atts);
        setLeaves(lvs);
        setDbDepartments(depts);
        setAppConfig(config);
        setHolidays(hols);
        setShifts(shiftsList);
        setShiftOverrides(overridesList);
        setSelectedDepts(depts);
        setCustomRecipients(config.defaultReportRecipient || user.email || '');

        // Fetch organization info for PDF header
        try {
          const branding = await organizationService.getOrgBranding();
          setOrgInfo(branding);
        } catch (e) { console.warn("Failed to fetch org info for PDF header"); }

        await fetchLogs();
      } catch (err) {
        console.error("Report data load failed", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
    let interval = setInterval(fetchLogs, 15000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchLogs();
        interval = setInterval(fetchLogs, 15000);
      } else {
        clearInterval(interval);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [user.id]);

  const toggleDept = (dept: string) => {
    setSelectedDepts(prev =>
      prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept]
    );
  };

  // Sync date range when period preset changes
  useEffect(() => {
    if (periodPreset === 'CUSTOM') return;
    const range = getDateRangeFromPreset(periodPreset);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  }, [periodPreset]);

  const handlePresetClick = (preset: string) => {
    setPeriodPreset(preset);
    if (preset !== 'CUSTOM') {
      const range = getDateRangeFromPreset(preset);
      setStartDate(range.startDate);
      setEndDate(range.endDate);
    }
  };

  const handleDateChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setPeriodPreset('CUSTOM');
  };

  const reportData = useMemo(() => {
    let combinedData: any[] = [];
    const isAttendanceReport = reportType === 'ATTENDANCE' || reportType === 'ABSENT' || reportType === 'LATE';

    // 1. Filter Records
    const filteredAttendance = attendance.filter(item => {
      if (item.date < startDate || item.date > endDate) return false;
      const emp = employees.find(e => e.id === item.employeeId);
      if (!emp) return false;
      if (selectedDepts.length > 0 && !selectedDepts.includes(emp.department)) return false;
      if (employeeFilter !== 'All Employees' && item.employeeId !== employeeFilter) return false;
      return true;
    });

    const filteredLeaves = leaves.filter(item => {
      if (item.startDate < startDate || item.startDate > endDate) return false;
      const emp = employees.find(e => e.id === item.employeeId);
      if (!emp) return false;
      if (selectedDepts.length > 0 && !selectedDepts.includes(emp.department)) return false;
      if (employeeFilter !== 'All Employees' && item.employeeId !== employeeFilter) return false;
      return true;
    });

    if (isAttendanceReport) {
      // Consolidate Attendance (Utilize Shared Logic)
      // This ensures Min(CheckIn) and Max(CheckOut) are used
      combinedData = consolidateAttendance(filteredAttendance);

      // Gap Analysis — per-employee shift working days
      if (appConfig) {
        const globalWorkingDays = appConfig.workingDays || [];
        const defaultShift = shifts.find(s => s.isDefault);
        const start = new Date(startDate);
        const end = new Date(endDate);

        const targetEmployees = employees.filter(e => {
          if (e.status !== 'ACTIVE') return false;
          if (selectedDepts.length > 0 && !selectedDepts.includes(e.department)) return false;
          if (employeeFilter !== 'All Employees' && e.id !== employeeFilter) return false;
          return true;
        });

        // Normalize 3-letter day abbreviations (DB default) to full names
        const DAY_MAP: Record<string, string> = {
          MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday',
          FRI: 'Friday', SAT: 'Saturday', SUN: 'Sunday',
        };
        const normDays = (days: string[]) => days.map(d => DAY_MAP[d.toUpperCase()] || d);

        // Resolve effective shift: override → employee shift → default shift
const getEffectiveShift = (emp: Employee, dateStr: string): Shift | null => {
  const override = shiftOverrides.find(
    (o: any) =>
      o.employeeId === emp.id &&
      dateStr >= o.startDate &&
      dateStr <= o.endDate
  );

  if (override) {
    const oShift = shifts.find(s => s.id === override.shiftId);
    if (oShift) return oShift;
  }

  if (emp.shiftId) {
    const aShift = shifts.find(s => s.id === emp.shiftId);
    if (aShift) return aShift;
  }

  return defaultShift || null;
};

const isShiftWorkingDate = (shift: Shift, dateStr: string): boolean => {
  if ((shift.scheduleType || 'WEEKLY') === 'CYCLE') {
    if (!shift.cycleStartDate || !shift.cycleWorkDays || !shift.cycleOffDays) {
      return false;
    }

    const current = new Date(`${dateStr}T00:00:00Z`);
    const cycleStart = new Date(`${shift.cycleStartDate}T00:00:00Z`);
if (current < cycleStart) {
  return false;
}
    const diffDays = Math.floor(
      (current.getTime() - cycleStart.getTime()) / 86400000
    );

    const cycleLength = shift.cycleWorkDays + shift.cycleOffDays;
    const position = ((diffDays % cycleLength) + cycleLength) % cycleLength;

    return position < shift.cycleWorkDays;
  }

  const dayName = new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(
    'en-US',
    { weekday: 'long', timeZone: 'UTC' }
  );

  return normDays(shift.workingDays || []).includes(dayName);
};

        // Use a set for quick lookup
        const presentSet = new Set(combinedData.map(d => `${d.employeeId}_${d.date}`));

        for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
          const dateStr = dt.toISOString().split('T')[0];
          const nowLocal = new Date();
const todayStr =
  nowLocal.getFullYear() +
  '-' +
  String(nowLocal.getMonth() + 1).padStart(2, '0') +
  '-' +
  String(nowLocal.getDate()).padStart(2, '0');

// Never generate ABSENT records for future dates
if (dateStr > todayStr) continue;
const dayName = dt.toLocaleDateString('en-US', { weekday: 'long' });
          const isHoliday = holidays.some(h => h.date === dateStr);

          if (isHoliday) continue;

          targetEmployees.forEach(emp => {
            if (emp.joiningDate && emp.joiningDate > dateStr) return;

            const effectiveShift = getEffectiveShift(emp, dateStr);

const isWorkingDay = effectiveShift
  ? isShiftWorkingDate(effectiveShift, dateStr)
  : globalWorkingDays.includes(dayName);

if (!isWorkingDay) return;
// Do not generate today's ABSENT until the employee's shift has ended
if (dateStr === todayStr && effectiveShift) {
  const [endHour, endMinute] = effectiveShift.endTime.split(':').map(Number);

  const shiftEnd = new Date(
    nowLocal.getFullYear(),
    nowLocal.getMonth(),
    nowLocal.getDate(),
    endHour,
    endMinute,
    0,
    0
  );

  // Overnight shift, e.g. 21:00 -> 06:00
  if (effectiveShift.endTime <= effectiveShift.startTime) {
    shiftEnd.setDate(shiftEnd.getDate() + 1);
  }

  if (nowLocal < shiftEnd) return;
}
            const isPresent = presentSet.has(`${emp.id}_${dateStr}`);
            const isOnLeave = filteredLeaves.some(l =>
              l.employeeId === emp.id && l.status === 'APPROVED' &&
              dateStr >= l.startDate.split(' ')[0] && dateStr <= l.endDate.split(' ')[0]
            );

            if (!isPresent && !isOnLeave) {
              combinedData.push({
                id: `absent-${emp.id}-${dateStr}`,
                employeeId: emp.id,
                employeeName: emp.name,
                date: dateStr,
                status: 'ABSENT',
                checkIn: '-',
                checkOut: '-',
                location: { address: 'Not Detected' },
                remarks: 'System Generated: No punch-in detected.'
              });
            }
          });
        }
      }
    } else {
      combinedData = filteredLeaves;
    }

    if (reportType === 'LATE') combinedData = combinedData.filter(a => a.status === 'LATE');
    if (reportType === 'ABSENT') combinedData = combinedData.filter(a => a.status === 'ABSENT');

    return combinedData.sort((a, b) => {
        const dateA = a.date || a.startDate;
        const dateB = b.date || b.startDate;
        return dateB.localeCompare(dateA);
    });
  }, [reportType, startDate, endDate, selectedDepts, employeeFilter, attendance, employees, leaves, appConfig, holidays]);

  // Compute per-employee summary for the Summary tab
  const employeeSummaries = useMemo<EmployeeAttendanceSummary[]>(() => {
    if (!appConfig || employees.length === 0) return [];

    // Consolidate filtered attendance (same logic as reportData for consistency)
    const filteredAttendance = attendance.filter(item => {
      if (item.date < startDate || item.date > endDate) return false;
      const emp = employees.find(e => e.id === item.employeeId);
      if (!emp) return false;
      if (selectedDepts.length > 0 && !selectedDepts.includes(emp.department)) return false;
      if (employeeFilter !== 'All Employees' && item.employeeId !== employeeFilter) return false;
      return true;
    });

    const consolidated = consolidateAttendance(filteredAttendance);

    // Approved leaves in range
    const approvedLeaves = leaves.filter(l => {
      if (l.status !== 'APPROVED') return false;
      return l.startDate <= endDate && l.endDate >= startDate;
    });

    return calculateEmployeeSummaries({
      employees,
      consolidatedAttendance: consolidated,
      approvedLeaves,
      shifts,
      shiftOverrides,
      appConfig,
      holidays,
      startDate,
      endDate,
      selectedDepts,
      employeeFilter,
    });
  }, [attendance, leaves, employees, shifts, shiftOverrides, appConfig, holidays, startDate, endDate, selectedDepts, employeeFilter]);
type TimesheetCode =
  | 'P'
  | 'L'
  | 'HD'
  | 'A'
  | 'W'
  | 'OFF'
  | 'HOL'
  | 'AL'
  | 'CL'
  | 'SL'
  | 'DO'
  | 'BT'
  | 'ML'
  | 'PL'
  | 'EL'
  | 'UL'
  | 'LV'
  | 'NA';

interface TimesheetDay {
  date: string;
  code: TimesheetCode;
  attendanceStatus?: string;
  leaveType?: string;
  shiftName?: string;
}

interface TimesheetRow {
  employee: Employee;
  days: TimesheetDay[];
  plannedDays: number;
  completedDays: number;
  remainingDays: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  leaveDays: number;
  workedHours: number;
}

const monthlyTimesheet = useMemo<TimesheetRow[]>(() => {
  const DAY_MAP: Record<string, string> = {
    MON: 'Monday',
    TUE: 'Tuesday',
    WED: 'Wednesday',
    THU: 'Thursday',
    FRI: 'Friday',
    SAT: 'Saturday',
    SUN: 'Sunday',
  };

  const normalizeDays = (days: string[] = []) =>
    days.map(d => DAY_MAP[d.toUpperCase()] || d);

  const getEffectiveShift = (
    emp: Employee,
    dateStr: string
  ): Shift | null => {
    const override = shiftOverrides.find(
      (o: any) =>
        o.employeeId === emp.id &&
        dateStr >= o.startDate &&
        dateStr <= o.endDate
    );

    if (override) {
      const shift = shifts.find(s => s.id === override.shiftId);
      if (shift) return shift;
    }

    if (emp.shiftId) {
      const shift = shifts.find(s => s.id === emp.shiftId);
      if (shift) return shift;
    }

    return shifts.find(s => s.isDefault) || null;
  };

  const isShiftWorkingDate = (
    shift: Shift,
    dateStr: string
  ): boolean => {
    if ((shift.scheduleType || 'WEEKLY') === 'CYCLE') {
      if (
        !shift.cycleStartDate ||
        !shift.cycleWorkDays ||
        !shift.cycleOffDays
      ) {
        return false;
      }

      const current = new Date(`${dateStr}T00:00:00Z`);
      const cycleStart = new Date(
        `${shift.cycleStartDate}T00:00:00Z`
      );

      // Shift cycle has not started yet.
      if (current < cycleStart) return false;

      const diffDays = Math.floor(
        (current.getTime() - cycleStart.getTime()) / 86400000
      );

      const cycleLength =
        shift.cycleWorkDays + shift.cycleOffDays;

      const position =
        ((diffDays % cycleLength) + cycleLength) % cycleLength;

      return position < shift.cycleWorkDays;
    }

    const dayName = new Date(
      `${dateStr}T00:00:00Z`
    ).toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    });

    return normalizeDays(shift.workingDays || []).includes(dayName);
  };

  const leaveCode = (type: string): TimesheetCode => {
    switch (type) {
      case 'ANNUAL':
        return 'AL';
      case 'CASUAL':
        return 'CL';
      case 'SICK':
        return 'SL';
      case 'DAY_OFF':
        return 'DO';
      case 'BUSINESS_TRIP':
        return 'BT';
      case 'MATERNITY':
        return 'ML';
      case 'PATERNITY':
        return 'PL';
      case 'EARNED':
        return 'EL';
      case 'UNPAID':
        return 'UL';
      default:
        return 'LV';
    }
  };

  const targetEmployees = employees.filter(emp => {
    if (emp.status !== 'ACTIVE') return false;

    if (
      selectedDepts.length > 0 &&
      !selectedDepts.includes(emp.department || '')
    ) {
      return false;
    }

    if (
      employeeFilter !== 'All Employees' &&
      emp.id !== employeeFilter
    ) {
      return false;
    }

    return true;
  });

  const consolidated = consolidateAttendance(
    attendance.filter(a =>
      a.date >= startDate &&
      a.date <= endDate
    )
  );

  const attendanceMap = new Map<string, Attendance>();

  consolidated.forEach(a => {
    attendanceMap.set(`${a.employeeId}_${a.date}`, a);
  });

  const holidaySet = new Set(
    holidays.map(h => h.date)
  );

  const now = new Date();

  const todayStr =
    now.getFullYear() +
    '-' +
    String(now.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(now.getDate()).padStart(2, '0');

  const rows: TimesheetRow[] = [];

  for (const emp of targetEmployees) {
    const days: TimesheetDay[] = [];

    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);

    for (
      let dt = new Date(start);
      dt <= end;
      dt.setUTCDate(dt.getUTCDate() + 1)
    ) {
      const dateStr = dt.toISOString().split('T')[0];

      // Before employee joined the company.
      if (emp.joiningDate && dateStr < emp.joiningDate) {
        days.push({
          date: dateStr,
          code: 'NA',
        });
        continue;
      }

      const shift = getEffectiveShift(emp, dateStr);

      if (!shift) {
        days.push({
          date: dateStr,
          code: 'OFF',
        });
        continue;
      }

      // Public holiday has priority over ordinary schedule.
      if (holidaySet.has(dateStr)) {
        days.push({
          date: dateStr,
          code: 'HOL',
          shiftName: shift.name,
        });
        continue;
      }

      const isWorkingDay = isShiftWorkingDate(
        shift,
        dateStr
      );

      // Scheduled day off.
      if (!isWorkingDay) {
        days.push({
          date: dateStr,
          code: 'OFF',
          shiftName: shift.name,
        });
        continue;
      }

      // Approved leave only replaces a scheduled working day.
      const approvedLeave = leaves.find(l => {
        if (l.employeeId !== emp.id) return false;
        if (l.status !== 'APPROVED') return false;

        const leaveStart = l.startDate.split(' ')[0];
        const leaveEnd = l.endDate.split(' ')[0];

        return (
          dateStr >= leaveStart &&
          dateStr <= leaveEnd
        );
      });

      if (approvedLeave) {
        days.push({
          date: dateStr,
          code: leaveCode(approvedLeave.type),
          leaveType: approvedLeave.type,
          shiftName: shift.name,
        });
        continue;
      }

      const attendanceRecord = attendanceMap.get(
        `${emp.id}_${dateStr}`
      );

      // Real attendance always wins once it exists.
      if (attendanceRecord) {
        let code: TimesheetCode = 'P';

        if (attendanceRecord.status === 'LATE') {
          code = 'L';
        } else if (
          attendanceRecord.status === 'HALF_DAY'
        ) {
          code = 'HD';
        } else if (
          attendanceRecord.status === 'ABSENT'
        ) {
          code = 'A';
        } else {
          code = 'P';
        }

        days.push({
          date: dateStr,
          code,
          attendanceStatus: attendanceRecord.status,
          shiftName: shift.name,
        });

        continue;
      }

      // Future scheduled work.
      if (dateStr > todayStr) {
        days.push({
          date: dateStr,
          code: 'W',
          shiftName: shift.name,
        });
        continue;
      }

      // Today: keep as WORK until the employee's shift has ended.
      if (dateStr === todayStr) {
        const [endHour, endMinute] = shift.endTime
          .split(':')
          .map(Number);

        const shiftEnd = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          endHour,
          endMinute,
          0,
          0
        );

        // Overnight shift, for example 21:00 -> 06:00.
        if (shift.endTime <= shift.startTime) {
          shiftEnd.setDate(shiftEnd.getDate() + 1);
        }

        if (now < shiftEnd) {
          days.push({
            date: dateStr,
            code: 'W',
            shiftName: shift.name,
          });
          continue;
        }
      }

      // Past scheduled working day with no attendance or leave.
      days.push({
        date: dateStr,
        code: 'A',
        shiftName: shift.name,
      });
    }

    const leaveCodes: TimesheetCode[] = [
  'AL',
  'CL',
  'SL',
  'DO',
  'BT',
  'ML',
  'PL',
  'EL',
  'UL',
  'LV',
];

const plannedDays = days.filter(day =>
  !['OFF', 'HOL', 'NA'].includes(day.code)
).length;
const completedDays = days.filter(day =>
  !['W', 'OFF', 'HOL', 'NA'].includes(day.code)
).length;

const remainingDays = days.filter(day =>
  day.code === 'W'
).length;

const presentDays = days.filter(day =>
  ['P', 'L', 'HD'].includes(day.code)
).length;

const absentDays = days.filter(day =>
  day.code === 'A'
).length;

const lateDays = days.filter(day =>
  day.code === 'L'
).length;

const leaveDays = days.filter(day =>
  leaveCodes.includes(day.code)
).length;

// Total actual worked hours from attendance check-in/check-out.
const workedMinutes = days.reduce((total, day) => {
  const record = attendanceMap.get(
    `${emp.id}_${day.date}`
  );

  if (
    !record?.checkIn ||
    !record?.checkOut ||
    record.checkIn === '-' ||
    record.checkOut === '-'
  ) {
    return total;
  }

  const [inHour, inMinute] = record.checkIn
    .split(':')
    .map(Number);

  const [outHour, outMinute] = record.checkOut
    .split(':')
    .map(Number);

  if (
    Number.isNaN(inHour) ||
    Number.isNaN(inMinute) ||
    Number.isNaN(outHour) ||
    Number.isNaN(outMinute)
  ) {
    return total;
  }

  const checkInMinutes = inHour * 60 + inMinute;
  let checkOutMinutes = outHour * 60 + outMinute;

  // Overnight shift, e.g. 21:00 -> 06:00.
  if (checkOutMinutes < checkInMinutes) {
    checkOutMinutes += 24 * 60;
  }

  return total + (checkOutMinutes - checkInMinutes);
}, 0);

const workedHours = Math.round((workedMinutes / 60) * 100) / 100;

rows.push({
  employee: emp,
  days,
  plannedDays,
  completedDays,
  remainingDays,
  presentDays,
  absentDays,
  lateDays,
  leaveDays,
  workedHours,
});
  }

  return rows;
}, [
  employees,
  attendance,
  leaves,
  shifts,
  shiftOverrides,
  holidays,
  startDate,
  endDate,
  selectedDepts,
  employeeFilter,
]);

  const downloadTimesheetExcel = () => {
  if (monthlyTimesheet.length === 0) {
    showToast("No timesheet data to export.", "warning");
    return;
  }

  setIsGenerating(true);

  try {
    const dayHeaders =
      monthlyTimesheet[0]?.days.map(day => day.date) || [];

    const dayLabels =
  monthlyTimesheet[0]?.days.map(day => {
    const date = new Date(`${day.date}T00:00:00Z`);

    const dayNumber = String(date.getUTCDate()).padStart(2, '0');

    const weekday = date
      .toLocaleDateString('en-US', {
        weekday: 'short',
        timeZone: 'UTC',
      })
      .toUpperCase();

    return `${dayNumber} ${weekday}`;
  }) || [];

const headers = [
  'Employee ID',
  'Employee Name',
  'Department',
  ...dayLabels,
  'Plan',
  'Elapsed',
  'Remaining',
  'Present',
  'Absent',
  'Late',
  'Leave',
  'Hours',
];

const rows = monthlyTimesheet.map(row => [
  row.employee.employeeId || '',
  row.employee.name || '',
  row.employee.department || '',
  ...row.days.map(day => day.code),
  row.plannedDays,
  row.completedDays,
  row.remainingDays,
  row.presentDays,
  row.absentDays,
  row.lateDays,
  row.leaveDays,
  row.workedHours,
]);

    const worksheet = XLSX.utils.aoa_to_sheet([
  ['Monthly Timesheet'],
  [`Period: ${startDate} to ${endDate}`],
  [],
  headers,
  ...rows,
]);

worksheet['!merges'] = [
  {
    s: { r: 0, c: 0 },
    e: { r: 0, c: headers.length - 1 },
  },
  {
    s: { r: 1, c: 0 },
    e: { r: 1, c: headers.length - 1 },
  },
];
    worksheet['!cols'] = [
      { wch: 18 },
      { wch: 32 },
      { wch: 20 },
      ...dayHeaders.map(() => ({ wch: 12 })),
      { wch: 10 },
      { wch: 10 },
      { wch: 11 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
    ];

const legendWorksheet = XLSX.utils.aoa_to_sheet([
  ['Code', 'Meaning'],
  ['P', 'Present'],
  ['L', 'Late'],
  ['HD', 'Half Day'],
  ['A', 'Absent'],
  ['W', 'Scheduled'],
  ['OFF', 'Off'],
  ['HOL', 'Holiday'],
  ['AL', 'Annual Leave'],
  ['CL', 'Casual Leave'],
  ['SL', 'Sick Leave'],
  ['DO', 'Day Off'],
  ['BT', 'Business Trip'],
  ['ML', 'Maternity Leave'],
  ['PL', 'Paternity Leave'],
  ['EL', 'Earned Leave'],
  ['UL', 'Unpaid Leave'],
  ['LV', 'Leave'],
  ['NA', 'Not Applicable'],
]);

legendWorksheet['!cols'] = [
  { wch: 12 },
  { wch: 28 },
];
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      'Monthly Timesheet'
    );
XLSX.utils.book_append_sheet(
  workbook,
  legendWorksheet,
  'Legend'
);
    XLSX.writeFile(
      workbook,
      `OpenHRApp_Timesheet_${startDate}_${endDate}.xlsx`
    );

    showToast("Excel timesheet exported successfully.", "success");
  } catch (error: any) {
    console.error("Timesheet Excel export failed:", error);

    showToast(
      "Failed to export Excel timesheet: " +
        (error?.message || error),
      "error"
    );
  } finally {
    setIsGenerating(false);
  }
};
  const getCleanReportData = () => {
    return reportData.map((row: any) => {
      const emp = employees.find(e => e.id === row.employeeId);
      const fullRow: any = {
        Employee_ID: emp?.employeeId || '',
        Name: row.employeeName || row.name || 'N/A',
        Date: row.date || row.startDate || 'N/A',
        Status_Type: row.status || row.type || 'N/A',
        Check_In: row.checkIn || 'N/A',
        Check_Out: row.checkOut || 'N/A',
        Location: row.location?.address || 'N/A',
        Latitude: row.location?.lat || 'N/A',
        Longitude: row.location?.lng || 'N/A',
        Remarks: row.remarks || row.reason || ''
      };
      const filteredRow: any = {};
      Object.keys(enabledColumns).forEach(col => { if (enabledColumns[col]) filteredRow[col] = fullRow[col]; });
      return filteredRow;
    });
  };

  const downloadCSV = () => {
    if (reportData.length === 0) { showToast("No data to export.", "warning"); return; }
    setIsGenerating(true);
    setTimeout(() => {
      const cleanData = getCleanReportData();
      const headers = Object.keys(cleanData[0]).join(",");
      const rows = cleanData.map(obj => Object.values(obj).map(val => `"${String(val).replace(/"/g, '""')}"`).join(","));
      const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + headers + "\n" + rows.join("\n");
      const link = document.createElement("a");
      link.setAttribute("href", encodeURI(csvContent));
      link.setAttribute("download", `OpenHRApp_${reportType}_Export.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setIsGenerating(false);
    }, 500);
  };

  const downloadPDF = async () => {
    if (reportData.length === 0) { showToast("No data to export.", "warning"); return; }
    setIsGeneratingPDF(true);
    try {
      const jsPDFModule = await import('jspdf');
      const autoTableModule = await import('jspdf-autotable');
      const jsPDF = jsPDFModule.default || jsPDFModule.jsPDF;
      if (autoTableModule.applyPlugin) autoTableModule.applyPlugin(jsPDF);

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();

      // --- Header ---
      let cursorY = 15;
      const logoSize = 20;
      let textStartX = 14;

      if (orgInfo.logoDataUrl) {
        try {
          const logoDims = await getScaledLogoDims(orgInfo.logoDataUrl, logoSize);
          doc.addImage(orgInfo.logoDataUrl, 'PNG', 14, cursorY - 5, logoDims.w, logoDims.h);
          textStartX = 14 + logoDims.w + 6;
        } catch { /* skip logo on error */ }
      }

      if (orgInfo.name) {
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(orgInfo.name, textStartX, cursorY + 2);
      }
      if (orgInfo.address) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text(orgInfo.address, textStartX, cursorY + 9);
      }

      cursorY += Math.max(logoSize, 14) + 6;

      // --- Title & Date Range ---
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(`${reportType} Report`, 14, cursorY);
      cursorY += 6;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(`Date Range: ${startDate} to ${endDate}`, 14, cursorY);
      cursorY += 10;

      // --- Summary Stats ---
      const totalRecords = reportData.length;
      const presentCount = reportData.filter((r: any) => r.status === 'PRESENT').length;
      const absentCount = reportData.filter((r: any) => r.status === 'ABSENT').length;
      const lateCount = reportData.filter((r: any) => r.status === 'LATE').length;
      const otherCount = totalRecords - presentCount - absentCount - lateCount;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('Summary', 14, cursorY);
      cursorY += 5;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      const statsText = `Total: ${totalRecords}    Present: ${presentCount}    Absent: ${absentCount}    Late: ${lateCount}    Other: ${otherCount}`;
      doc.text(statsText, 14, cursorY);
      cursorY += 8;

      // --- Table ---
      const cleanData = getCleanReportData();
      const columns = Object.keys(cleanData[0]);
      const tableHeaders = columns.map(col => {
        const opt = columnOptions.find(o => o.key === col);
        return opt ? opt.label : col;
      });
      const tableRows = cleanData.map(row => columns.map(col => String(row[col] ?? '')));

      (doc as any).autoTable({
        startY: cursorY,
        head: [tableHeaders],
        body: tableRows,
        theme: 'grid',
        headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7, textColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 14, right: 14 },
        styles: { cellPadding: 2, overflow: 'linebreak' },
      });

      // --- Footer on each page ---
      const totalPages = (doc as any).internal.getNumberOfPages();
      const now = new Date().toLocaleString();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text(`Generated by OpenHRApp on ${now}`, 14, pageHeight - 8);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
      }

      doc.save(`OpenHRApp_${reportType}_Export.pdf`);
    } catch (err: any) {
      console.error("PDF generation failed:", err);
      showToast("Failed to generate PDF: " + (err?.message || err), "error");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  // --- Summary Tab Exports ---

  const downloadSummaryCSV = () => {
    if (employeeSummaries.length === 0) { showToast("No summary data to export.", "warning"); return; }
    setIsGenerating(true);
    setTimeout(() => {
      const headers = ['Employee ID', 'Name', 'Department', 'Designation', 'Working Days', 'Present', 'Absent', 'Late', 'Leave', 'Half Days', 'Attendance %'];
      const rows = employeeSummaries.map(s => [
        s.employeeId, s.employeeName, s.department, s.designation,
        s.totalWorkingDays, s.presentDays, s.absentDays, s.lateDays,
        s.leaveDays, s.halfDays, `${s.attendancePercentage}%`
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      const csvContent = 'data:text/csv;charset=utf-8,﻿' + headers.join(',') + '\n' + rows.join('\n');
      const link = document.createElement('a');
      link.setAttribute('href', encodeURI(csvContent));
      link.setAttribute('download', `OpenHRApp_Employee_Summary_${startDate}_to_${endDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setIsGenerating(false);
    }, 500);
  };

  const downloadSummaryPDF = async () => {
    if (employeeSummaries.length === 0) { showToast("No summary data to export.", "warning"); return; }
    setIsGeneratingPDF(true);
    try {
      const jsPDFModule = await import('jspdf');
      const autoTableModule = await import('jspdf-autotable');
      const jsPDF = jsPDFModule.default || jsPDFModule.jsPDF;
      if (autoTableModule.applyPlugin) autoTableModule.applyPlugin(jsPDF);

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();

      // --- Header (reuse same pattern) ---
      let cursorY = 15;
      const logoSize = 20;
      let textStartX = 14;

      if (orgInfo.logoDataUrl) {
        try {
          const logoDims = await getScaledLogoDims(orgInfo.logoDataUrl, logoSize);
          doc.addImage(orgInfo.logoDataUrl, 'PNG', 14, cursorY - 5, logoDims.w, logoDims.h);
          textStartX = 14 + logoDims.w + 6;
        } catch { /* skip logo on error */ }
      }

      if (orgInfo.name) {
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(orgInfo.name, textStartX, cursorY + 2);
      }
      if (orgInfo.address) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text(orgInfo.address, textStartX, cursorY + 9);
      }

      cursorY += Math.max(logoSize, 14) + 6;

      // --- Title & Period ---
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('Employee Attendance Summary', 14, cursorY);
      cursorY += 6;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(`Period: ${startDate} to ${endDate}  •  ${employeeSummaries.length} Employees`, 14, cursorY);
      cursorY += 10;

      // --- Summary Stats ---
      const totalPresent = employeeSummaries.reduce((s, e) => s + e.presentDays, 0);
      const totalAbsent = employeeSummaries.reduce((s, e) => s + e.absentDays, 0);
      const totalLate = employeeSummaries.reduce((s, e) => s + e.lateDays, 0);
      const totalLeave = employeeSummaries.reduce((s, e) => s + e.leaveDays, 0);
      const avgAttendance = employeeSummaries.length > 0
        ? Math.round(employeeSummaries.reduce((s, e) => s + e.attendancePercentage, 0) / employeeSummaries.length)
        : 0;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('Summary', 14, cursorY);
      cursorY += 5;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(
        `Total Present: ${totalPresent}    Absent: ${totalAbsent}    Late: ${totalLate}    Leave: ${totalLeave}    Avg. Attendance: ${avgAttendance}%`,
        14, cursorY
      );
      cursorY += 8;

      // --- Table ---
      const tableHeaders = ['#', 'Employee', 'Dept', 'Work Days', 'Present', 'Absent', 'Late', 'Leave', 'Half', '%'];
      const tableRows = employeeSummaries.map((s, i) => [
        i + 1, s.employeeName, s.department, s.totalWorkingDays,
        s.presentDays, s.absentDays, s.lateDays, s.leaveDays, s.halfDays, `${s.attendancePercentage}%`
      ]);

      (doc as any).autoTable({
        startY: cursorY,
        head: [tableHeaders],
        body: tableRows,
        theme: 'grid',
        headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7, textColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 14, right: 14 },
        styles: { cellPadding: 2, overflow: 'linebreak' },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 35 },
          2: { cellWidth: 28 },
          3: { cellWidth: 18, halign: 'center' },
          4: { cellWidth: 16, halign: 'center' },
          5: { cellWidth: 16, halign: 'center' },
          6: { cellWidth: 16, halign: 'center' },
          7: { cellWidth: 16, halign: 'center' },
          8: { cellWidth: 14, halign: 'center' },
          9: { cellWidth: 14, halign: 'center' },
        },
      });

      // --- Footer ---
      const totalPages = (doc as any).internal.getNumberOfPages();
      const now = new Date().toLocaleString();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text(`Generated by OpenHRApp on ${now}`, 14, pageHeight - 8);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
      }

      doc.save(`OpenHRApp_Employee_Summary_${startDate}_to_${endDate}.pdf`);
    } catch (err: any) {
      console.error("Summary PDF generation failed:", err);
      showToast("Failed to generate PDF: " + (err?.message || err), "error");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleEmailSummaryReport = async () => {
    if (employeeSummaries.length === 0) { showToast("No summary data to email.", "warning"); return; }
    setIsEmailing(true);
    try {
      const rawTarget = customRecipients;
      if (!rawTarget) throw new Error("Please enter at least one recipient email address.");
      const targets = rawTarget.split(',').map(t => t.trim()).filter(t => t.includes('@'));
      if (targets.length === 0) throw new Error("No valid email addresses found.");

      const periodLabel = periodPreset.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const dateRange = `${startDate} to ${endDate}`;

      for (const target of targets) {
        await emailService.sendEmployeeSummaryReport(target, employeeSummaries, periodLabel, dateRange);
      }
      showToast(`Summary report queued for ${targets.length} recipient(s).`, "success");
      setTimeout(fetchLogs, 1000);
    } catch (err: any) { showToast(err.message || "Email relay failed.", "error"); }
    finally { setIsEmailing(false); }
  };

  const handleEmailSummary = async () => {
    if (reportData.length === 0) { showToast("There is no data in the current report to email.", "warning"); return; }
    setIsEmailing(true);
    try {
      const rawTarget = customRecipients;
      if (!rawTarget) throw new Error("Please enter at least one recipient email address.");
      const targets = rawTarget.split(',').map(t => t.trim()).filter(t => t.includes('@'));
      if (targets.length === 0) throw new Error("No valid email addresses found.");

      const BATCH_SIZE = 350;
      const chunks = [];
      for (let i = 0; i < reportData.length; i += BATCH_SIZE) { chunks.push(reportData.slice(i, i + BATCH_SIZE)); }

      let totalEmails = 0;
      for (const target of targets) {
        for (let i = 0; i < chunks.length; i++) {
           const chunk = chunks[i];
           const suffix = chunks.length > 1 ? ` [Part ${i+1}/${chunks.length}]` : '';
           await emailService.sendDailyAttendanceSummary(target, chunk as Attendance[], suffix);
           totalEmails++;
        }
      }
      showToast(`Report summary queued for ${targets.length} recipient(s).`, "success");
      setTimeout(fetchLogs, 1000);
    } catch (err: any) { showToast(err.message || "Email relay failed.", "error"); } 
    finally { setIsEmailing(false); }
  };

  if (isLoading) return <div className="flex flex-col items-center justify-center h-64 text-slate-400"><RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-4" /><p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Initializing Reporting Engine...</p></div>;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-3xl font-bold text-slate-900 tracking-tight">Audit & Reports</h1><HelpButton helpPointId="reports.generator" /></div>
          <p className="text-slate-500 font-medium text-sm">Employee attendance summary & detailed record extraction</p>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 space-y-8">

          {/* ===== SHARED FILTERS ===== */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 md:p-12 space-y-8">
            {/* Period Presets */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <p className="text-[10px] font-semibold uppercase text-slate-400 tracking-widest">Period</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: 'THIS_WEEK', label: 'This Week', icon: CalendarDays },
                  { key: 'THIS_MONTH', label: 'This Month', icon: Calendar },
                  { key: 'THIS_YEAR', label: 'This Year', icon: TrendingUp },
                  { key: 'LAST_MONTH', label: 'Last Month', icon: Calendar },
                  { key: 'LAST_YEAR', label: 'Last Year', icon: TrendingUp },
                ].map(p => (
                  <button key={p.key} onClick={() => handlePresetClick(p.key)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-semibold uppercase tracking-wider transition-all border ${
                      periodPreset === p.key ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-slate-50 text-slate-500 border-slate-100 hover:border-indigo-200 hover:text-indigo-600'
                    }`}>
                    <p.icon size={14} />{p.label}
                  </button>
                ))}
                <button onClick={() => handlePresetClick('CUSTOM')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-semibold uppercase tracking-wider transition-all border ${
                    periodPreset === 'CUSTOM' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-slate-50 text-slate-500 border-slate-100 hover:border-indigo-200 hover:text-indigo-600'
                  }`}>
                  <CalendarDays size={14} />Custom
                </button>
              </div>
              {periodPreset === 'CUSTOM' && (
                <div className="flex gap-2 pt-2">
                  <div className="flex-1 min-w-0 space-y-1"><label className="text-[8px] font-semibold text-slate-400 uppercase tracking-[0.2em] px-1">From</label><input type="date" className="w-full min-w-0 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-bold outline-none" value={startDate} onChange={handleDateChange(setStartDate)} /></div>
                  <div className="flex-1 min-w-0 space-y-1"><label className="text-[8px] font-semibold text-slate-400 uppercase tracking-[0.2em] px-1">To</label><input type="date" className="w-full min-w-0 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-bold outline-none" value={endDate} onChange={handleDateChange(setEndDate)} /></div>
                </div>
              )}
            </div>

            {/* Department Filter */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <p className="text-[10px] font-semibold uppercase text-slate-400 tracking-widest">Departments ({selectedDepts.length}/{dbDepartments.length})</p>
                <div className="flex gap-4">
                  <button onClick={() => setSelectedDepts(dbDepartments)} className="text-[9px] font-semibold uppercase text-indigo-600 hover:underline">Select All</button>
                  <button onClick={() => setSelectedDepts([])} className="text-[9px] font-semibold uppercase text-rose-500 hover:underline">Clear All</button>
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto no-scrollbar grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-1 border border-slate-50 rounded-3xl py-4 bg-slate-50/30">
                {dbDepartments.map(dept => {
                  const isSelected = selectedDepts.includes(dept);
                  return (
                    <button key={dept} onClick={() => toggleDept(dept)} className={`flex items-center gap-3 p-3.5 rounded-2xl border transition-all text-left ${isSelected ? 'bg-white border-primary/30 shadow-sm' : 'bg-transparent border-transparent opacity-60'}`}>
                      <div className={`p-1 rounded-md ${isSelected ? 'bg-primary text-white' : 'bg-slate-200 text-slate-400'}`}>{isSelected ? <CheckSquare size={14} /> : <Square size={14} />}</div>
                      <span className={`text-[11px] font-bold truncate ${isSelected ? 'text-slate-900' : 'text-slate-500'}`}>{dept}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Employee Scoping + Recipient */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[8px] font-semibold text-slate-400 uppercase tracking-[0.2em] px-1">Employee Scoping</label>
                <select className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs outline-none" value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}>
                  <option value="All Employees">All Active Employees</option>
                  {employees.filter(e => { if (selectedDepts.length === 0) return true; return selectedDepts.includes(e.department || ''); }).map(e => <option key={e.id} value={e.id}>{e.name} ({e.employeeId})</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-semibold text-slate-400 uppercase tracking-[0.2em] px-1">Recipient(s)</label>
                <input type="text" placeholder="email1@example.com, email2@example.com" className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs outline-none" value={customRecipients} onChange={e => setCustomRecipients(e.target.value)}/>
              </div>
            </div>
          </div>

          {/* ===== SECTION 1: EMPLOYEE SUMMARY ===== */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 md:p-12 space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-100 rounded-xl"><PieChart size={20} className="text-indigo-600" /></div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Employee Summary Report</h2>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Per-employee attendance breakdown</p>
              </div>
            </div>

            {/* Stat Cards */}
            {employeeSummaries.length === 0 ? (
              <div className="text-center py-12 bg-slate-50 rounded-2xl border border-slate-100">
                <Users size={40} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm font-semibold text-slate-400">No employee data for this period</p>
                <p className="text-xs text-slate-400 mt-1">Try adjusting the date range or department filters.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'Employees', value: employeeSummaries.length, color: 'bg-indigo-50 text-indigo-700 border-indigo-100', icon: Users },
                  { label: 'Total Present', value: employeeSummaries.reduce((s: any, e: any) => s + e.presentDays, 0), color: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: CheckCircle2 },
                  { label: 'Total Absent', value: employeeSummaries.reduce((s: any, e: any) => s + e.absentDays, 0), color: 'bg-rose-50 text-rose-700 border-rose-100', icon: AlertCircle },
                  { label: 'Total Late', value: employeeSummaries.reduce((s: any, e: any) => s + e.lateDays, 0), color: 'bg-amber-50 text-amber-700 border-amber-100', icon: Clock },
                  { label: 'Total Leave', value: employeeSummaries.reduce((s: any, e: any) => s + e.leaveDays, 0), color: 'bg-blue-50 text-blue-700 border-blue-100', icon: FileText },
                  { label: 'Avg. Att.', value: employeeSummaries.length > 0 ? `${Math.round(employeeSummaries.reduce((s: any, e: any) => s + e.attendancePercentage, 0) / employeeSummaries.length)}%` : '—', color: 'bg-slate-100 text-slate-700 border-slate-200', icon: PieChart },
                ].map((stat: any) => (
                  <div key={stat.label} className={`${stat.color} rounded-2xl p-4 border text-center`}>
                    <stat.icon size={18} className="mx-auto mb-1.5 opacity-60" />
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-[8px] font-semibold uppercase tracking-wider mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[9px] text-slate-400 text-center">
              Per-employee breakdown is included in the CSV / PDF export and email report.
            </p>

            {/* Summary Export Buttons */}
            <div className="pt-4 border-t border-slate-50 space-y-3">
              <div className="flex gap-3">
                <button onClick={downloadSummaryCSV} disabled={isGenerating || employeeSummaries.length === 0} className="flex-1 flex items-center justify-center gap-3 py-4 bg-primary text-white rounded-xl font-semibold text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-primary-hover transition-all active:scale-95 disabled:opacity-50">{isGenerating ? <RefreshCw className="animate-spin" size={16} /> : <FileSpreadsheet size={16} />} CSV Summary</button>
                <button onClick={downloadSummaryPDF} disabled={isGeneratingPDF || employeeSummaries.length === 0} className="flex-1 flex items-center justify-center gap-3 py-4 bg-slate-900 text-white rounded-xl font-semibold text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-50">{isGeneratingPDF ? <RefreshCw className="animate-spin" size={16} /> : <FileDown size={16} />} PDF Summary</button>
              </div>
              <button onClick={handleEmailSummaryReport} disabled={isEmailing || employeeSummaries.length === 0} className="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-semibold uppercase text-[10px] tracking-widest flex items-center justify-center gap-3 hover:bg-indigo-50 hover:text-indigo-600 transition-all shadow-sm disabled:opacity-50">{isEmailing ? <RefreshCw className="animate-spin" size={16} /> : <Mail size={16} />} Email Summary Report</button>
            </div>
          </div>

{/* ===== MONTHLY TIMESHEET ===== */}
<div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 md:p-12 space-y-6">
  <div className="flex items-center justify-between gap-4 flex-wrap">
    <div className="flex items-center gap-3">
      <div className="p-2.5 bg-emerald-100 rounded-xl">
        <CalendarDays size={20} className="text-emerald-600" />
      </div>

      <div>
        <h2 className="text-lg font-bold text-slate-900">
          Monthly Timesheet
        </h2>

        <p className="text-[10px] text-slate-400 uppercase tracking-wider">
          Planned schedule + leave + actual attendance
        </p>
      </div>
    </div>
<button
  onClick={downloadTimesheetExcel}
  disabled={isGenerating || monthlyTimesheet.length === 0}
  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-semibold text-[9px] uppercase tracking-wider shadow-sm hover:bg-emerald-700 transition-all disabled:opacity-50"
>
  {isGenerating ? (
    <RefreshCw className="animate-spin" size={14} />
  ) : (
    <FileSpreadsheet size={14} />
  )}
  Excel Timesheet
</button>
    <div className="flex flex-wrap gap-2 text-[9px] font-semibold uppercase">
      {[
        ['P', 'Present', 'bg-emerald-100 text-emerald-700'],
        ['L', 'Late', 'bg-amber-100 text-amber-700'],
        ['A', 'Absent', 'bg-rose-100 text-rose-700'],
        ['W', 'Scheduled', 'bg-indigo-100 text-indigo-700'],
        ['OFF', 'Off', 'bg-slate-100 text-slate-500'],
        ['SL', 'Sick', 'bg-rose-50 text-rose-600'],
        ['AL', 'Annual', 'bg-blue-50 text-blue-600'],
        ['DO', 'Day Off', 'bg-sky-50 text-sky-600'],
        ['BT', 'Business Trip', 'bg-violet-50 text-violet-600'],
        ['HOL', 'Holiday', 'bg-fuchsia-50 text-fuchsia-600'],
      ].map(([code, label, cls]) => (
        <div
          key={code}
          className={`px-2.5 py-1.5 rounded-lg ${cls}`}
        >
          {code} — {label}
        </div>
      ))}
    </div>
  </div>

  {monthlyTimesheet.length === 0 ? (
    <div className="text-center py-12 bg-slate-50 rounded-2xl border border-slate-100">
      <CalendarDays
        size={40}
        className="mx-auto text-slate-300 mb-3"
      />

      <p className="text-sm font-semibold text-slate-400">
        No timesheet data for this period
      </p>
    </div>
  ) : (
    <div className="overflow-x-auto border border-slate-100 rounded-2xl">
      <table className="min-w-max w-full border-collapse text-[10px]">
        <thead>
          <tr className="bg-slate-50">
            <th className="sticky left-0 z-20 bg-slate-50 px-4 py-3 text-left border-b border-r border-slate-100 min-w-[220px]">
              Employee
            </th>

            {monthlyTimesheet[0]?.days.map(day => {
              const d = new Date(`${day.date}T00:00:00Z`);

              const dayNumber = String(
                d.getUTCDate()
              ).padStart(2, '0');

              const weekday = d.toLocaleDateString(
                'en-US',
                {
                  weekday: 'short',
                  timeZone: 'UTC',
                }
              );

              return (
                <th
                  key={day.date}
                  className="px-2 py-2 border-b border-r border-slate-100 text-center min-w-[46px]"
                  title={day.date}
                >
                  <div className="font-bold text-slate-700">
                    {dayNumber}
                  </div>

                  <div className="text-[8px] text-slate-400 uppercase">
                    {weekday}
                  </div>
                </th>
              );
            })}
<th
  className="px-3 py-2 border-b border-r border-l-2 border-slate-200 text-center min-w-[64px] bg-indigo-50 text-indigo-700"
  title="Total scheduled working days for the selected period"
>
  Plan
</th>

<th
  className="px-3 py-2 border-b border-r border-slate-100 text-center min-w-[70px] bg-slate-50 text-slate-700"
  title="Scheduled working days that have already occurred"
>
  Elapsed
</th>

<th className="px-3 py-2 border-b border-r border-slate-100 text-center min-w-[70px] bg-indigo-50 text-indigo-600">
  Remaining
</th>

<th className="px-3 py-2 border-b border-r border-slate-100 text-center min-w-[60px] bg-emerald-50 text-emerald-700">
  Present
</th>

<th className="px-3 py-2 border-b border-r border-slate-100 text-center min-w-[60px] bg-rose-50 text-rose-700">
  Absent
</th>

<th className="px-3 py-2 border-b border-r border-slate-100 text-center min-w-[55px] bg-amber-50 text-amber-700">
  Late
</th>

<th className="px-3 py-2 border-b border-r border-slate-100 text-center min-w-[60px] bg-blue-50 text-blue-700">
  Leave
</th>

<th
  className="px-3 py-2 border-b border-slate-100 text-center min-w-[70px] bg-cyan-50 text-cyan-700"
  title="Actual worked hours calculated from check-in and check-out"
>
  Hours
</th>
          </tr>
        </thead>

        <tbody>
          {monthlyTimesheet.map(row => (
            <tr
              key={row.employee.id}
              className="hover:bg-slate-50/70"
            >
              <td className="sticky left-0 z-10 bg-white px-4 py-3 border-b border-r border-slate-100">
                <div className="font-semibold text-slate-800">
                  {row.employee.name}
                </div>

                <div className="text-[8px] text-slate-400 mt-0.5">
                  {row.employee.employeeId || '—'}
                  {row.employee.department
                    ? ` • ${row.employee.department}`
                    : ''}
                </div>
              </td>

              {row.days.map(day => {
                const codeClasses: Record<string, string> = {
                  P: 'bg-emerald-100 text-emerald-700',
                  L: 'bg-amber-100 text-amber-700',
                  HD: 'bg-orange-100 text-orange-700',
                  A: 'bg-rose-100 text-rose-700',
                  W: 'bg-indigo-100 text-indigo-700',
                  OFF: 'bg-slate-100 text-slate-400',
                  HOL: 'bg-fuchsia-100 text-fuchsia-700',
                  AL: 'bg-blue-100 text-blue-700',
                  CL: 'bg-emerald-50 text-emerald-600',
                  SL: 'bg-rose-50 text-rose-600',
                  DO: 'bg-sky-100 text-sky-700',
                  BT: 'bg-violet-100 text-violet-700',
                  ML: 'bg-pink-100 text-pink-700',
                  PL: 'bg-indigo-50 text-indigo-600',
                  EL: 'bg-amber-50 text-amber-600',
                  UL: 'bg-slate-200 text-slate-600',
                  LV: 'bg-blue-50 text-blue-600',
                  NA: 'bg-white text-slate-200',
                };

                return (
                  <td
                    key={day.date}
                    className="border-b border-r border-slate-100 p-1 text-center"
                    title={[
                      day.date,
                      `Status: ${day.code}`,
                      day.shiftName
                        ? `Shift: ${day.shiftName}`
                        : '',
                      day.leaveType
                        ? `Leave: ${day.leaveType}`
                        : '',
                    ]
                      .filter(Boolean)
                      .join('\n')}
                  >
                    <div
                      className={`w-9 h-8 mx-auto rounded-lg flex items-center justify-center font-bold ${codeClasses[day.code] || 'bg-slate-100 text-slate-500'}`}
                    >
                      {day.code}
                    </div>
                  </td>
                );
              })}
<td className="px-3 py-3 border-b border-r border-l-2 border-slate-200 text-center font-bold text-indigo-700 bg-indigo-50/40">
  {row.plannedDays}
</td>

<td className="px-3 py-3 border-b border-r border-slate-100 text-center font-bold text-slate-700 bg-slate-50/40">
  {row.completedDays}
</td>

<td className="px-3 py-3 border-b border-r border-slate-100 text-center font-bold text-indigo-600 bg-indigo-50/30">
  {row.remainingDays}
</td>

<td className="px-3 py-3 border-b border-r border-slate-100 text-center font-bold text-emerald-700 bg-emerald-50/40">
  {row.presentDays}
</td>

<td className="px-3 py-3 border-b border-r border-slate-100 text-center font-bold text-rose-700 bg-rose-50/40">
  {row.absentDays}
</td>

<td className="px-3 py-3 border-b border-r border-slate-100 text-center font-bold text-amber-700 bg-amber-50/40">
  {row.lateDays}
</td>

<td className="px-3 py-3 border-b border-r border-slate-100 text-center font-bold text-blue-700 bg-blue-50/40">
  {row.leaveDays}
</td>

<td
  className="px-3 py-3 border-b border-slate-100 text-center font-bold text-cyan-700 bg-cyan-50/40"
  title="Actual worked hours"
>
  {row.workedHours.toFixed(2)}
</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}
</div>
          {/* ===== SECTION 2: DETAIL RECORDS ===== */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 md:p-12 space-y-8">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-slate-100 rounded-xl"><FileText size={20} className="text-slate-700" /></div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Detail Records Report</h2>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Individual attendance & leave records</p>
              </div>
            </div>

            {/* Report Type */}
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase text-slate-400 tracking-widest">Report Type</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {['ATTENDANCE', 'ABSENT', 'LATE', 'LEAVE'].map((id) => (
                  <button key={id} onClick={() => setReportType(id)} className={`flex items-center gap-2 p-4 rounded-xl border transition-all ${reportType === id ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : 'bg-white border-slate-100 hover:bg-slate-50'}`}>
                    <div className={`p-2 rounded-lg ${reportType === id ? 'bg-white/10' : 'bg-indigo-500 text-white'}`}><FileText size={14} /></div>
                    <span className="font-semibold text-[10px] uppercase tracking-tight">{id}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Configure Columns (collapsible) */}
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer text-[10px] font-semibold uppercase text-slate-400 tracking-widest hover:text-slate-600 transition-colors">
                <Settings2 size={14} />
                Configure Export Columns ({Object.values(enabledColumns).filter(Boolean).length} active)
                <span className="ml-auto text-[9px] text-slate-300 group-open:hidden">Click to expand</span>
              </summary>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-50">
                {columnOptions.map((col) => (
                  <button key={col.key} onClick={() => setEnabledColumns(p => ({...p, [col.key]: !p[col.key]}))} className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${enabledColumns[col.key] ? 'bg-primary/5 border-primary/20' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${enabledColumns[col.key] ? 'bg-primary text-white' : 'bg-slate-200 text-slate-400'}`}><col.icon size={14} /></div>
                      <span className="text-[10px] font-semibold uppercase tracking-tight">{col.label}</span>
                    </div>
                    {enabledColumns[col.key] && <CheckCircle size={16} className="text-primary" />}
                  </button>
                ))}
              </div>
            </details>

            {/* Detail Export Buttons */}
            <div className="pt-4 border-t border-slate-50 space-y-3">
              <div className="flex gap-3">
                <button onClick={downloadCSV} disabled={isGenerating || reportData.length === 0} className="flex-1 flex items-center justify-center gap-3 py-4 bg-primary text-white rounded-xl font-semibold text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-primary-hover transition-all active:scale-95 disabled:opacity-50">{isGenerating ? <RefreshCw className="animate-spin" size={16} /> : <FileSpreadsheet size={16} />} CSV Export</button>
                <button onClick={downloadPDF} disabled={isGeneratingPDF || reportData.length === 0} className="flex-1 flex items-center justify-center gap-3 py-4 bg-slate-900 text-white rounded-xl font-semibold text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-50">{isGeneratingPDF ? <RefreshCw className="animate-spin" size={16} /> : <FileDown size={16} />} PDF Export</button>
              </div>
              <button onClick={handleEmailSummary} disabled={isEmailing || reportData.length === 0} className="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-semibold uppercase text-[10px] tracking-widest flex items-center justify-center gap-3 hover:bg-indigo-50 hover:text-indigo-600 transition-all shadow-sm disabled:opacity-50">{isEmailing ? <RefreshCw className="animate-spin" size={16} /> : <Mail size={16} />} Email Detail Report</button>
            </div>
          </div>

        </div>

        {/* ===== LIVE PREVIEW SIDEBAR (always summary) ===== */}
        <div className="bg-[#0f172a] rounded-2xl p-8 text-white shadow-xl space-y-8 flex flex-col sticky top-24 h-fit animate-in zoom-in duration-700">
           <div className="flex-1 space-y-8">
             <div className="flex items-center justify-between"><h3 className="text-xl font-semibold flex items-center gap-3"><Search className="text-indigo-400" /> Live Preview</h3><div className="p-2 bg-white/10 rounded-xl cursor-pointer hover:bg-white/20 transition-all" onClick={fetchLogs} title="Refresh Email Status"><RefreshCw size={16} /></div></div>
             <div className="p-8 bg-white/5 rounded-xl border border-white/10 text-center space-y-6">
               <div><p className="text-[9px] font-semibold text-slate-400 uppercase tracking-[0.2em] mb-1">Employees</p><p className="text-6xl font-semibold text-white">{employeeSummaries.length}</p></div>
               <div className="grid grid-cols-2 gap-2">
                 {[
                   { label: 'Present', count: employeeSummaries.reduce((s, e) => s + e.presentDays, 0), color: 'text-emerald-400' },
                   { label: 'Absent', count: employeeSummaries.reduce((s, e) => s + e.absentDays, 0), color: 'text-rose-400' },
                   { label: 'Late', count: employeeSummaries.reduce((s, e) => s + e.lateDays, 0), color: 'text-amber-400' },
                   { label: 'Leave', count: employeeSummaries.reduce((s, e) => s + e.leaveDays, 0), color: 'text-blue-400' },
                 ].map(stat => (
                   <div key={stat.label} className="bg-white/5 rounded-xl p-3 text-center">
                     <p className={`text-lg font-bold ${stat.color}`}>{stat.count}</p>
                     <p className="text-[9px] uppercase tracking-wider text-slate-400">{stat.label}</p>
                   </div>
                 ))}
               </div>
               <div className="h-px bg-white/10 w-1/2 mx-auto"></div>
               <div>
                 <p className="text-[8px] font-semibold text-indigo-400 uppercase tracking-widest mb-1">Avg. Attendance</p>
                 <p className="text-3xl font-bold text-white">
                   {employeeSummaries.length > 0
                     ? `${Math.round(employeeSummaries.reduce((s, e) => s + e.attendancePercentage, 0) / employeeSummaries.length)}%`
                     : '—'}
                 </p>
               </div>
             </div>
             <div className="space-y-4">
               <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500"><Activity size={14} className="text-indigo-400" /> Recent Email Activity</div>
               <div className="bg-slate-900 border border-white/10 rounded-3xl p-2 max-h-48 overflow-y-auto no-scrollbar space-y-1">
                 {emailLogs.length === 0 ? (<p className="text-center text-[9px] font-semibold text-slate-600 uppercase py-4">No recent activity</p>) : (emailLogs.map(log => (<div key={log.id} className="p-3 bg-white/5 rounded-2xl flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[9px] font-bold text-white truncate">{log.recipient_email}</p><p className="text-[8px] font-medium text-slate-500 truncate">{log.subject}</p></div><div className={`px-2 py-0.5 rounded-full text-[8px] font-semibold uppercase ${log.status === 'SENT' ? 'bg-emerald-500/20 text-emerald-400' : log.status === 'FAILED' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'}`}>{log.status}</div></div>)))}
               </div>
               {emailLogs.some(l => l.status === 'FAILED') && (<div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex gap-2"><AlertCircle size={14} className="text-rose-400 flex-shrink-0" /><p className="text-[9px] font-medium text-rose-300 leading-tight">Some emails failed. Verify SMTP settings in Admin Panel &gt; Settings &gt; Mail.</p></div>)}
               {isHookMissing && (<div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex gap-2"><HelpCircle size={14} className="text-amber-400 flex-shrink-0" /><div className="space-y-1"><p className="text-[9px] font-bold text-amber-300 leading-tight uppercase">Backend Hook Not Detected</p><p className="text-[8px] font-medium text-amber-400/80 leading-tight">Emails are stuck in PENDING. Ensure <code>main.pb.js</code> is in your PocketBase <code>pb_hooks</code> folder.</p></div></div>)}
             </div>
           </div>
           <div className="p-6 bg-indigo-500/10 rounded-xl border border-indigo-500/20"><p className="text-[9px] font-semibold text-indigo-300 uppercase tracking-[0.3em] mb-2">Technical Info</p><div className="space-y-1 text-[10px] font-bold text-slate-300 uppercase"><p>Format: CSV / PDF</p><p>Mode: Per-Employee Summary + Detail Records</p></div></div>
        </div>
      </div>
    </div>
  );
};

export default Reports;
