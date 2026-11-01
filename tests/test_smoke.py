"""Smoke tests. Run with: python -m unittest discover -s tests"""
import unittest

class AppSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import app as app_module
        cls.module = app_module
        cls.client = app_module.app.test_client()
        response = cls.client.post('/login', data={'email':'admin@joyuniversity.edu','password':'Admin@123'}, follow_redirects=True)
        if response.status_code != 200:
            raise RuntimeError('Admin login smoke test failed')

    def test_dashboard_and_bus_api(self):
        self.assertEqual(self.client.get('/dashboard').status_code, 200)
        overview = self.client.get('/api/overview')
        self.assertEqual(overview.status_code, 200)
        self.assertEqual(overview.json['counts']['buses'], 10)
        self.assertEqual(len(self.client.get('/api/buses').json), 10)

    def test_gps_rejected_without_token(self):
        r = self.client.post('/api/tracking/location', json={'bus_id':1,'latitude':8.24,'longitude':77.6})
        self.assertEqual(r.status_code, 401)

    def test_csv_template(self):
        r = self.client.get('/templates/buses.csv')
        self.assertEqual(r.status_code, 200)
        self.assertIn(b'Bus Number', r.data)

if __name__ == '__main__': unittest.main()
