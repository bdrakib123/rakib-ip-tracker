"use strict";

const { MongoClient, ObjectId } = require("mongodb");

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class MongoVisitorRepository {
  constructor(collection, db) {
    this.collection = collection;
    this.db = db;
  }

  async ensureIndexes() {
    await this.collection.createIndex({ createdAt: -1 });
    await this.collection.createIndex({ ipHash: 1, createdAt: -1 });
  }

  countByIpHash(hash) {
    return this.collection.countDocuments({ ipHash: { $in: Array.isArray(hash) ? hash : [hash] } });
  }

  insert(document) {
    return this.collection.insertOne(document).then(result => ({ ...document, _id: result.insertedId }));
  }

  async history({ page = 1, limit = 50, maxLimit = 100, search = "", country = "", device = "", ipSearchHashes = [] } = {}) {
    const safePage = Math.max(1, Math.min(10000, Number.parseInt(page, 10) || 1));
    const safeLimit = Math.max(1, Math.min(maxLimit, Number.parseInt(limit, 10) || 50));
    const conditions = [];
    const safeSearch = typeof search === "string" ? search.slice(0, 80) : "";
    const safeCountry = typeof country === "string" ? country.slice(0, 80) : "";
    const safeDevice = typeof device === "string" ? device.slice(0, 30) : "";
    if (safeSearch) {
      const regex = new RegExp(escapeRegex(safeSearch), "i");
      const searchConditions = [
        { ipMasked: regex }, { "geo.city": regex }, { "geo.region": regex }, { "geo.country": regex },
        { city: regex }, { region: regex }, { country: regex }, { "device.model": regex },
        { "device.vendor": regex }, { "browser.name": regex }, { "os.name": regex }
      ];
      if (Array.isArray(ipSearchHashes)) {
        const safeHashes = ipSearchHashes.filter(hash => typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash));
        if (safeHashes.length) searchConditions.push({ ipHash: { $in: safeHashes } });
      }
      conditions.push({ $or: searchConditions });
    }
    if (safeCountry) conditions.push({ $or: [{ "geo.country": safeCountry }, { country: safeCountry }] });
    if (safeDevice) conditions.push({ $or: [{ "device.category": safeDevice }, { "device.type": safeDevice }] });
    const query = conditions.length ? { $and: conditions } : {};
    const [total, data] = await Promise.all([
      this.collection.countDocuments(query),
      this.collection.find(query).sort({ createdAt: -1, _id: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray()
    ]);
    return { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit), data };
  }

  findById(id) {
    if (!ObjectId.isValid(String(id))) return Promise.resolve(null);
    return this.collection.findOne({ _id: new ObjectId(String(id)) });
  }

  async overview() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const match = { createdAt: { $gte: since } };
    const [allVisitors, last24h, countries, devices, browsers, operatingSystems, daily] = await Promise.all([
      this.collection.countDocuments({}),
      this.collection.countDocuments(match),
      this.collection.aggregate([
        { $match: match }, { $group: { _id: { $ifNull: ["$geo.country", "$country"] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 8 }
      ]).toArray(),
      this.collection.aggregate([
        { $match: match }, { $group: { _id: { $ifNull: ["$device.category", "$device.type"] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 8 }
      ]).toArray(),
      this.collection.aggregate([
        { $match: match }, { $group: { _id: "$browser.name", count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 8 }
      ]).toArray(),
      this.collection.aggregate([
        { $match: match }, { $group: { _id: "$os.name", count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 8 }
      ]).toArray(),
      this.collection.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - 7 * 86400000) } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }, { $limit: 7 }
      ]).toArray()
    ]);
    const rows = items => items.filter(item => item._id).map(item => ({ name: item._id, count: item.count }));
    return {
      totalVisitors: allVisitors,
      last24h,
      countries: rows(countries),
      devices: rows(devices),
      browsers: rows(browsers),
      operatingSystems: rows(operatingSystems),
      daily: daily.map(item => ({ date: item._id, count: item.count }))
    };
  }

  async ping() {
    await this.db.command({ ping: 1 });
    return true;
  }
}

async function connectMongo({ uri, dbName, collectionName, MongoClientClass = MongoClient }) {
  const client = new MongoClientClass(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 10 });
  try {
    await client.connect();
    const db = client.db(dbName);
    const repository = new MongoVisitorRepository(db.collection(collectionName), db);
    await repository.ensureIndexes();
    return { client, db, repository };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

module.exports = { MongoVisitorRepository, connectMongo, escapeRegex };
