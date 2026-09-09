export function buildGridMetadata(grid, { externalUrl = 'https://simulation.cryptgregresearch.org/' } = {}) {
  const zone = String(grid.zone_id || grid.zone || 'unknown');
  return {
    name: `Eastern Paradise Grid #${grid.x}-${grid.y}`,
    symbol: 'EPLAND',
    description: `Ownership of grid ${grid.x},${grid.y} within Eastern Paradise.`,
    external_url: externalUrl,
    attributes: [
      { trait_type: 'Grid ID', value: grid.grid_id },
      { trait_type: 'Grid X', value: grid.x },
      { trait_type: 'Grid Y', value: grid.y },
      { trait_type: 'Zone', value: zone.replace(/(^|_)(\w)/g, (_, lead, char) => `${lead ? ' ' : ''}${char.toUpperCase()}`).trim() },
      { trait_type: 'World', value: 'Eastern Paradise' }
    ],
    properties: {
      category: 'image',
      world: 'Eastern Paradise',
      grid_id: grid.grid_id,
      coordinates: { x: grid.x, y: grid.y },
      collection: 'Eastern Paradise Land'
    }
  };
}

export function buildGridSvg(grid) {
  const title = `Grid ${grid.x},${grid.y}`;
  const zone = String(grid.zone_id || grid.zone || 'Eastern Paradise');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#102d25"/><stop offset="1" stop-color="#d99b55"/></linearGradient></defs>
  <rect width="1200" height="1200" fill="url(#sky)"/><path d="M100 760 600 470l500 290-500 290z" fill="#4c8b62" stroke="#f4cf87" stroke-width="18"/>
  <path d="M600 470v580M100 760l500 290 500-290" fill="none" stroke="#d6ad68" stroke-width="8" opacity=".55"/>
  <text x="600" y="180" fill="#fff6db" font-family="serif" font-size="76" text-anchor="middle">Eastern Paradise Land</text>
  <text x="600" y="300" fill="#f4cf87" font-family="monospace" font-size="92" font-weight="bold" text-anchor="middle">${title}</text>
  <text x="600" y="1120" fill="#fff6db" font-family="sans-serif" font-size="46" text-anchor="middle">${zone}</text></svg>`;
}

