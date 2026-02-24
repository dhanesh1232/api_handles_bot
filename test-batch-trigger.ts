
import axios from 'axios';

async function testBatchTrigger() {
  const url = 'http://localhost:4000/api/saas/workflows/trigger';
  const apiKey = "ERIXDE022108B494597415C47FFB09C25EC1355B9E0564A5515D"; // Assuming local dev key
  const clientCode = 'ERIX_CLNT1';

  const payload = [
    {
      trigger: 'appointment_confirmed',
      phone: '918143963821',
      callbackUrl: 'http://localhost:3000/api/workflows/callback',
      callbackMetadata: {
        moduleId: 'test-appointment-123',
        moduleType: 'Appointment',
        reminderKey: 'confirmed'
      },
      variables: ['John Doe', 'Dr. Smith', 'Monday, Oct 27 at 10:00 AM', 'abc-defg-hij']
    },
    {
      trigger: 'appointment_reminder',
      phone: '918143963821',
      baseTime: new Date(),
      delayMinutes: 1,
      callbackUrl: 'http://localhost:3000/api/workflows/callback',
      callbackMetadata: {
        moduleId: 'test-appointment-123',
        moduleType: 'Appointment',
        reminderKey: '1h'
      },
      variables: ['John Doe', 'Dr. Smith', 'Monday, Oct 27 at 10:00 AM', 'abc-defg-hij']
    }
  ];

  try {
    console.log('Testing Batch Trigger...');
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'x-client-code': clientCode
      }
    });
    console.log('Success:', response.data);
  } catch (error: any) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testBatchTrigger();
