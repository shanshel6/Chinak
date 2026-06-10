const tests = [
  'https://img.alicdn.com/bao/uploaded/i4/O1CN016iCrgH1Wo1KhtkQtW_!!0-fleamarket.jpg_790x10000Q90.jpg_',
  'https://img.alicdn.com/bao/uploaded/i4/O1CN016iCrgH1Wo1KhtkQtW_!!0-fleamarket.jpg_790x10000Q90.jpg_ (1×1)',
  'https://img.alicdn.com/bao/uploaded/i1/O1CN01F4fiah1KUX9u0PyIE_!!0-fleamarket.jpg_790x10000Q90.jpg_',
  'https://img.alicdn.com/bao/uploaded/i2/O1CN01x8xbuK2FsjvINxy5I_!!0-fleamarket.jpg_110x10000Q90.jpg_',
  'https://img.alicdn.com/bao/uploaded/i3/O1CN01LPyj6b1KUX9sbPqmL_!!0-fleamarket.jpg_790x10000Q90.jpg',
  'https://img.alicdn.com/bao/uploaded/i2/O1CN01EqlJVC1QgKeIgR8P0_!!0-mytaobao.jpg_110x10000Q90.jpg_',
];

const regex = /_+\s*\(.*\)\s*$/;
tests.forEach(t => {
  const fixed = t.replace(regex, '');
  console.log('IN:  ' + t);
  console.log('OUT: ' + fixed);
  console.log('---');
});
