import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ConsentWording {
  id: string;
  version: string;
  locale: string;
  body: string;
}

/**
 * The consent wording shown above the submit button. The text is counsel's: it is inserted by a migration or
 * SQL with `approvedAt` set, and only approved rows are ever served. With no approved text the guest flow
 * must refuse to start (fail closed), so an unreviewed wording can never be presented to a guest.
 * Each submission stores the id of the exact row shown, which is the proof of what the guest agreed to.
 */
@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Latest approved wording in `locale`, or null. `locale` is one of the supported guest languages. */
  async current(locale: string): Promise<ConsentWording | null> {
    const row = await this.prisma.consentText.findFirst({
      where: { locale, approvedAt: { not: null, lte: new Date() } },
      orderBy: [{ approvedAt: 'desc' }, { version: 'desc' }],
    });
    return row ? { id: row.id, version: row.version, locale: row.locale, body: row.body } : null;
  }

  /** The wording a guest saw, by id, only if it is an approved row (used when validating a submission). */
  async approvedById(id: string): Promise<ConsentWording | null> {
    const row = await this.prisma.consentText.findFirst({ where: { id, approvedAt: { not: null, lte: new Date() } } });
    return row ? { id: row.id, version: row.version, locale: row.locale, body: row.body } : null;
  }
}
