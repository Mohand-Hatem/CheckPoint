import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ShiftVersion } from '@prisma/client';
import { CompanyPolicyService } from '../company/company-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { AssignShiftDto } from './dto/assign-shift.dto';
import { CreateCompanyPolicyVersionDto } from './dto/create-company-policy-version.dto';
import { CreateShiftDto } from './dto/create-shift.dto';
import { CreateShiftVersionDto } from './dto/create-shift-version.dto';

const DEFAULT_EARLY_MINUTES = 60;
const MAX_DATE = new Date('9999-12-31T00:00:00.000Z');

@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
    private readonly companyPolicy: CompanyPolicyService,
  ) {}

  async getCompanyPolicy(companyId: string) {
    const [timezone, versions] = await Promise.all([
      this.companyPolicy.getTimezone(companyId),
      this.prisma.companyPolicyVersion.findMany({
        where: { companyId },
        orderBy: { effectiveFrom: 'desc' },
      }),
    ]);

    return { timezone, versions };
  }

  async createCompanyPolicyVersion(
    companyId: string,
    userId: string,
    dto: CreateCompanyPolicyVersionDto,
  ) {
    validateTimezone(dto.timezone);
    const effectiveFrom = parseDateOnly(dto.effectiveFrom);
    const companyDate = await this.companyPolicy.getCompanyDate(companyId);

    return this.withConflictHandling(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const overlapping = await tx.companyPolicyVersion.findMany({
              where: {
                companyId,
                effectiveFrom: { lte: MAX_DATE },
                OR: [
                  { effectiveTo: null },
                  { effectiveTo: { gte: effectiveFrom } },
                ],
              },
              orderBy: { effectiveFrom: 'asc' },
            });
            const prior = overlapping.filter(
              (version) => version.effectiveFrom < effectiveFrom,
            );
            const futureOrSame = overlapping.filter(
              (version) => version.effectiveFrom >= effectiveFrom,
            );

            if (prior.length > 1 || futureOrSame.length > 0) {
              throw new ConflictException(
                'The company policy effective date overlaps an existing version.',
              );
            }

            const previous = prior[0];
            if (previous) {
              await tx.companyPolicyVersion.update({
                where: { id: previous.id },
                data: { effectiveTo: previousDate(effectiveFrom) },
              });
            }

            const version = await tx.companyPolicyVersion.create({
              data: {
                companyId,
                timezone: dto.timezone,
                monthlyHoursDivisor: previous?.monthlyHoursDivisor ?? 30,
                effectiveFrom,
                createdByUserId: userId,
              },
            });

            if (effectiveFrom <= companyDate) {
              await tx.setting.upsert({
                where: { companyId_key: { companyId, key: 'timezone' } },
                update: { value: dto.timezone, updatedByUserId: userId },
                create: {
                  companyId,
                  key: 'timezone',
                  value: dto.timezone,
                  updatedByUserId: userId,
                },
              });
            }

            return version;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      'A company policy version already overlaps those effective dates.',
    );
  }

  async listShifts(companyId: string) {
    return this.prisma.shift.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      include: {
        versions: {
          orderBy: { effectiveFrom: 'desc' },
          include: { weekdays: { orderBy: { weekday: 'asc' } } },
        },
      },
    });
  }

  async getShift(companyId: string, shiftId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, companyId },
      include: {
        versions: {
          orderBy: { effectiveFrom: 'desc' },
          include: { weekdays: { orderBy: { weekday: 'asc' } } },
        },
        assignments: {
          orderBy: { effectiveFrom: 'desc' },
          include: {
            employee: {
              select: { id: true, employeeNumber: true, fullName: true },
            },
          },
        },
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    return shift;
  }

  async createShift(companyId: string, userId: string, dto: CreateShiftDto) {
    validateShiftVersion(dto.version);
    if (!dto.name.trim()) {
      throw new BadRequestException('Shift name is required.');
    }

    return this.withConflictHandling(
      () =>
        this.prisma.$transaction(async (tx) => {
          const shift = await tx.shift.create({
            data: { companyId, name: dto.name.trim() },
          });
          const version = await this.createVersion(
            tx,
            companyId,
            shift.id,
            userId,
            dto.version,
          );

          return { ...shift, versions: [version] };
        }),
      'A shift with that name already exists in this company.',
    );
  }

  async createShiftVersion(
    companyId: string,
    shiftId: string,
    userId: string,
    dto: CreateShiftVersionDto,
  ) {
    validateShiftVersion(dto);

    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, companyId, isActive: true },
      select: { id: true },
    });
    if (!shift) {
      throw new NotFoundException('Active shift not found');
    }

    return this.withConflictHandling(
      () =>
        this.prisma.$transaction(
          (tx) => this.createVersion(tx, companyId, shiftId, userId, dto),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      'A shift version already overlaps those effective dates.',
    );
  }

  private async withConflictHandling<T>(
    operation: () => Promise<T>,
    message: string,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        throw new ConflictException(message);
      }
      throw error;
    }
  }

  async assignShift(
    companyId: string,
    shiftId: string,
    userId: string,
    dto: AssignShiftDto,
  ) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, companyId, isActive: true },
      select: { id: true },
    });
    if (!shift) {
      throw new NotFoundException('Active shift not found');
    }

    const effectiveFrom = parseDateOnly(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null;
    validateDateRange(effectiveFrom, effectiveTo);
    const companyDate = await this.companyPolicy.getCompanyDate(companyId);

    return this.withConflictHandling(
      () =>
        this.prisma.$transaction(
          (tx) =>
            this.employees.assignShift(tx, {
              companyId,
              employeeId: dto.employeeId,
              shiftId,
              effectiveFrom,
              effectiveTo,
              assignedByUserId: userId,
              companyDate,
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      'The employee already has an assignment overlapping those effective dates.',
    );
  }

  private async createVersion(
    tx: Prisma.TransactionClient,
    companyId: string,
    shiftId: string,
    userId: string,
    dto: CreateShiftVersionDto,
  ): Promise<ShiftVersion> {
    const effectiveFrom = parseDateOnly(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null;
    validateDateRange(effectiveFrom, effectiveTo);

    const overlapping = await tx.shiftVersion.findMany({
      where: {
        companyId,
        shiftId,
        effectiveFrom: { lte: effectiveTo ?? MAX_DATE },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
      orderBy: { effectiveFrom: 'asc' },
    });
    const prior = overlapping.filter(
      (version) => version.effectiveFrom < effectiveFrom,
    );
    const futureOrSame = overlapping.filter(
      (version) => version.effectiveFrom >= effectiveFrom,
    );

    if (prior.length > 1 || futureOrSame.length > 0) {
      throw new ConflictException(
        'The shift version effective date overlaps an existing version.',
      );
    }

    if (prior[0]) {
      await tx.shiftVersion.update({
        where: { id: prior[0].id },
        data: { effectiveTo: previousDate(effectiveFrom) },
      });
    }

    const startTime = toUtcTime(dto.startTime);
    const endTime = toUtcTime(dto.endTime);
    return tx.shiftVersion.create({
      data: {
        companyId,
        shiftId,
        startTime,
        endTime,
        earlyMinutes: DEFAULT_EARLY_MINUTES,
        graceMinutes: dto.graceMinutes,
        redPeriodMinutes: dto.redPeriodMinutes,
        effectiveFrom,
        effectiveTo,
        createdByUserId: userId,
        weekdays: {
          create: dto.weekdays.map((weekday) => ({ companyId, weekday })),
        },
      },
    });
  }
}

export function validateShiftVersion(dto: CreateShiftVersionDto): void {
  const startMinute = parseTimeMinutes(dto.startTime);
  const endMinute = parseTimeMinutes(dto.endTime);
  const duration = endMinute - startMinute;

  if (duration <= 0) {
    throw new BadRequestException(
      'Overnight shifts are not supported; endTime must be later than startTime.',
    );
  }

  if (
    DEFAULT_EARLY_MINUTES >= dto.graceMinutes ||
    dto.graceMinutes >= dto.redPeriodMinutes ||
    dto.redPeriodMinutes >= duration
  ) {
    throw new BadRequestException(
      'Durations must satisfy 60 early minutes < graceMinutes < redPeriodMinutes < shift duration.',
    );
  }

  const effectiveFrom = parseDateOnly(dto.effectiveFrom);
  const effectiveTo = dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null;
  validateDateRange(effectiveFrom, effectiveTo);

  if (
    !Array.isArray(dto.weekdays) ||
    dto.weekdays.length === 0 ||
    dto.weekdays.some(
      (weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6,
    ) ||
    new Set(dto.weekdays).size !== dto.weekdays.length
  ) {
    throw new BadRequestException(
      'Select one or more unique weekdays from 0 (Sunday) through 6 (Saturday).',
    );
  }
}

function parseTimeMinutes(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new BadRequestException('Shift times must use HH:mm 24-hour format.');
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function toUtcTime(value: string): Date {
  parseTimeMinutes(value);
  return new Date(`1970-01-01T${value}:00.000Z`);
}

function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Dates must use YYYY-MM-DD format.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(
      'The effective date is not a valid calendar date.',
    );
  }
  return date;
}

function validateDateRange(effectiveFrom: Date, effectiveTo: Date | null) {
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new BadRequestException(
      'effectiveTo must be on or after effectiveFrom.',
    );
  }
}

function previousDate(value: Date): Date {
  return new Date(value.getTime() - 24 * 60 * 60 * 1000);
}

function validateTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new BadRequestException('timezone must be a valid IANA timezone.');
    }
    throw error;
  }
}
