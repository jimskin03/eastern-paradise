export function acceptsGzip(header = '') {
  const encodings = String(header).toLowerCase().split(',').map(value => {
    const [name, ...params] = value.trim().split(';');
    const quality = params.find(param => param.trim().startsWith('q='));
    return { name, quality: quality ? Number(quality.trim().slice(2)) : 1 };
  });
  return (encodings.find(value => value.name === 'gzip')
    ?? encodings.find(value => value.name === '*'))?.quality > 0;
}
