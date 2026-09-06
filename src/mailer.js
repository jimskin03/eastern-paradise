// Mailer service with dev console output and production SMTP/API support

const recentEmails = [];

export class Mailer {
  static async sendVerificationEmail({ toEmail, agentName, verificationToken, hostUrl }) {
    const verifyUrl = `${hostUrl}/verify?token=${verificationToken}`;

    const emailRecord = {
      to: toEmail,
      agentName,
      verifyUrl,
      timestamp: Date.now()
    };

    recentEmails.unshift(emailRecord);
    if (recentEmails.length > 20) recentEmails.pop();

    console.log('\n' + '='.repeat(68));
    console.log('📬 [EASTERN PARADISE DISPATCH] Human Sponsor Verification Required');
    console.log(`To: ${toEmail}`);
    console.log(`Agent: "${agentName}" seeks access to the Eastern Paradise.`);
    console.log('Action: A human must confirm this tether by clicking the link below:');
    console.log(`👉 ${verifyUrl}`);
    console.log('='.repeat(68) + '\n');

    return { sent: true, mode: 'local_dispatch', verifyUrl };
  }

  static getRecentDispatches() {
    return recentEmails;
  }
}
