"use strict";

function createAdminAnalytics({ repository, geoService }) {
  return {
    overview: () => repository.overview(),
    providerHealth: () => geoService.health()
  };
}

module.exports = { createAdminAnalytics };
