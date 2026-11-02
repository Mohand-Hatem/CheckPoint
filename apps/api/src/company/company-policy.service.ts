import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const TIMEZONE_SETTING_KEY = 'timezone';

@Injectable()
export class CompanyPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async getTimezone(companyId: string, date = new Date()): Promise<string> {
    const [policies, setting] = await Promise.all([
      this.prisma.companyPolicyVersion.findMany({
        where: { companyId },
        orderBy: { effectiveFrom: 'asc' },
      }),
      this.prisma.setting.findUnique({
        where: { companyId_key: { companyId, key: TIMEZONE_SETTING_KEY } },
        select: { value: true },
      }),
    ]);
    let timezone =
      typeof setting?.value === 'string' ? setting.value : undefined;

    if (!timezone) {
      throw new InternalServerErrorException(
        'Company timezone is not configured. Run the database seed or configure a company policy.',
      );
    }

    for (const policy of policies) {
      const effectiveDate = dateOnlyInTimezone(date, timezone);
      if (
        policy.effectiveFrom <= effectiveDate &&
        (policy.effectiveTo === null || policy.effectiveTo >= effectiveDate)
      ) {
        timezone = policy.timezone;
      }
    }

    return timezone;
  }

  async getCompanyDate(companyId: string, now = new Date()): Promise<Date> {
    const timezone = await this.getTimezone(companyId, now);
    return dateOnlyInTimezone(now, timezone);
  }
}

function dateOnlyInTimezone(value: Date, timezone: string): Date {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new InternalServerErrorException(
        'The configured company timezone is invalid.',
      );
    }
    throw error;
  }

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) {
    throw new InternalServerErrorException(
      'Could not resolve the current company-local date.',
    );
  }

  return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
}
