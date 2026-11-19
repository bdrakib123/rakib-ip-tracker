"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createVisitorService } = require("../src/services/visitorService");

test("current and legacy visitor documents adapt without changing stored shapes", async () => {
  const records = [
    {
      _id: "old-1", ipMasked: "203.0.113.xxx", ip: "203.0.113.8",
      country: "Legacy Republic", countryCode: "LR", region: "Old Region", city: "Old City",
      postalCode: "777", time_zone: "Etc/UTC", provider: "Legacy ISP", org: "Legacy Org", as: "AS123",
      lat: 10, lon: 20, device: { type: "mobile", vendor: "Xiaomi", model: "Redmi 10C" },
      browser: { name: "Chrome", version: "120" }, os: { name: "Android", version: "11" }, createdAt: new Date(1)
    },
    {
      _id: "new-1", ipMasked: "198.51.100.xxx", geo: { country: "New Republic", city: "New City", isp: "New ISP", latitude: 30, longitude: 40 },
      geoStatus: { status: "partial" }, device: { category: "desktop", brand: "Example", model: null }, createdAt: new Date(2)
    }
  ];
  const repository = {
    async history() { return { page: 1, limit: 20, total: records.length, pages: 1, data: records }; },
    async countByIpHash() { return 0; }, async insert() {}, async findById() { return null; }
  };
  const service = createVisitorService({
    repository,
    geoService: { lookup: async () => ({ status: "unavailable", fields: {} }) },
    detectDevice: () => ({}), encryptionKey: "abcdef0123456789".repeat(4), logger: { warn() {} }
  });
  const publicResult = await service.history({});
  assert.equal(publicResult.data[0].geo.fields.country.value, "Legacy Republic");
  assert.equal(publicResult.data[0].geo.fields.isp, undefined);
  assert.equal(publicResult.data[0].ip, "203.0.113.xxx");
  assert.equal(publicResult.data[0].device, undefined);
  assert.equal(publicResult.data[0].id, undefined);
  assert.equal(publicResult.data[1].geo.fields.city.value, "New City");
  assert.equal(publicResult.data[1].ip, "198.51.100.xxx");
  const adminResult = await service.adminHistory({});
  assert.equal(adminResult.data[0].geo.fields.isp.value, "Legacy ISP");
  assert.equal(adminResult.data[0].geo.fields.latitude.value, 10);
  assert.equal(records[0].country, "Legacy Republic");
  assert.equal(records[0].geo, undefined);
});
