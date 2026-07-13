import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260713205538 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "newsletter_subscriber" add constraint CK_newsletter_subscriber_eligibility_requires_confirmation check(not first_purchase_discount_eligible or status = 'CONFIRMED');`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "newsletter_subscriber" drop constraint if exists CK_newsletter_subscriber_eligibility_requires_confirmation;`);
  }

}
