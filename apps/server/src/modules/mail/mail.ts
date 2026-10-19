import nodemailer from 'nodemailer';

// Outgoing mail goes through a port. Messages name the service and carry a link or a notice, and nothing about money, Folds or
// members (FR-105, FR-107).

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  /** False when no transport is configured, so the service can say verification is off (FR-105). */
  readonly enabled: boolean;
}

export const verificationMessage = (to: string, link: string): MailMessage => ({
  to,
  subject: 'Confirm your email address for Cashfold',
  text: `Open this link to confirm your email address:\n\n${link}\n\nIf you did not create a Cashfold account, ignore this message. The link works once and expires in 24 hours.\n`,
});

/**
 * Tells someone they were invited, naming only the person who asked. No Fold name, member list or financial content (FR-107):
 * mail passes through servers nobody here controls.
 */
export const invitationMessage = (to: string, from: string, appUrl: string): MailMessage => ({
  to,
  subject: 'You have been invited to share on Cashfold',
  text: `${from} invited you to share on Cashfold.\n\nOpen Cashfold and look under Folds to see the invitation:\n\n${appUrl.replace(/\/+$/, '')}/folds/\n\nCompare the fingerprint with ${from} before you accept. If you do not know them, ignore this message.\n`,
});

export const lockoutMessage = (to: string): MailMessage => ({
  to,
  subject: 'Several failed sign-in attempts on your Cashfold account',
  text: 'Someone tried to sign in to your Cashfold account several times with a wrong password. Further attempts are being slowed down.\n\nIf this was you, wait a few minutes and try again. If not, no action is needed: they cannot sign in without your Secret Key.\n',
});

export function createLogMailer(log: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Mailer & { readonly sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    enabled: true,
    sent,
    async send(message) {
      sent.push(message);
      log(`mail to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
    },
  };
}

export function createSmtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return { enabled: true, send: async (m) => void (await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text })) };
}

export const noMailer: Mailer = { enabled: false, async send() {} };
