export interface GroupInput {
  title: string;
  description: string;
  coverId: string;
  detailImageIds: string[];
  specs: { name: string; price: string; stock: string }[];
  minimum: string;
  deadline: string;
  shippingAt: string;
}
export interface GroupRecord extends Omit<GroupInput, 'specs'> {
  id: string;
  revision: number;
  status: 'draft' | 'published';
  displayStatus: 'draft' | 'ongoing' | 'ended';
  publishedAt: string | null;
  specs: (GroupInput['specs'][number] & { priceCents: number | null })[];
}
export type FieldErrors = Record<string, string>;
export const emptyGroup = (): GroupInput => ({
  title: '', description: '', coverId: '', detailImageIds: [],
  specs: [{ name: '', price: '', stock: '' }], minimum: '', deadline: '', shippingAt: '',
});
export function priceCents(price: string): number | null {
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(price)) return null;
  const [yuan, decimal = ''] = price.split('.');
  const cents = Number(yuan) * 100 + Number(decimal.padEnd(2, '0'));
  return cents >= 1 && cents <= 9999999 ? cents : null;
}
export function beijingTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}:00+08:00`);
  return Number.isFinite(time) && new Date(time + 8 * 3600000).toISOString().slice(0, 16) === value ? time : NaN;
}
export function validateGroup(value: unknown, publish: boolean, now = Date.now()): { input?: GroupInput; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { errors: { form: '请提交有效的商品表单。' } };
  const v = value as Record<string, unknown>;
  const strings = ['title', 'description', 'coverId', 'minimum', 'deadline', 'shippingAt'] as const;
  if (Object.keys(v).some(k => ![...strings, 'specs', 'detailImageIds'].includes(k)) || strings.some(k => typeof v[k] !== 'string') || !Array.isArray(v.specs) || !Array.isArray(v.detailImageIds)) {
    return { errors: { form: '表单格式不正确，请重新加载草稿后重试。' } };
  }
  const input: GroupInput = { ...emptyGroup(), ...Object.fromEntries(strings.map(k => [k, (v[k] as string).trim()])) };
  if ((publish || input.title) && (input.title.length < 2 || input.title.length > 40)) errors.title = '请填写 2～40 字商品名称。';
  if ((publish || input.description) && (input.description.length < 1 || input.description.length > 2000)) errors.description = '请填写 1～2000 字商品说明。';
  if ((publish || input.coverId) && !/^[a-f0-9-]{36}$/.test(input.coverId)) errors.coverId = '请上传一张 JPG / PNG 封面，单张不超过 5MB。';
  if (v.detailImageIds.length > 8 || v.detailImageIds.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))) errors.detailImageIds = '详情图最多 8 张，请完成上传后重试。';
  else input.detailImageIds = v.detailImageIds as string[];
  if (v.specs.length < 1 || v.specs.length > 20) errors.specs = '请设置 1～20 个商品规格。';
  const names = new Set<string>();
  let total = 0;
  input.specs = v.specs.slice(0, 20).map((item: unknown, i: number) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.specs = '规格格式无效，请重新填写。'; return { name: '', price: '', stock: '' }; }
    const s = item as Record<string, unknown>;
    if (Object.keys(s).some(k => !['name', 'price', 'stock'].includes(k)) || ['name', 'price', 'stock'].some(k => typeof s[k] !== 'string')) {
      errors.specs = '规格名称、价格和库存请使用文本输入。'; return { name: '', price: '', stock: '' };
    }
    const spec = { name: (s.name as string).trim(), price: (s.price as string).trim(), stock: (s.stock as string).trim() };
    if ((publish || spec.name) && (spec.name.length < 1 || spec.name.length > 30)) errors[`specs.${i}.name`] = '规格名需为 1～30 字。';
    if (spec.name && names.has(spec.name)) errors[`specs.${i}.name`] = '规格名重复，请修改名称。';
    names.add(spec.name);
    const cents = priceCents(spec.price);
    if ((publish || spec.price) && cents === null) errors[`specs.${i}.price`] = '单价需为 0.01～99999.99 元，最多两位小数。';
    if (cents !== null) spec.price = (cents / 100).toFixed(2);
    if ((publish || spec.stock) && (!/^\d{1,4}$/.test(spec.stock) || Number(spec.stock) < 1 || Number(spec.stock) > 9999)) errors[`specs.${i}.stock`] = '库存需为 1～9999 件的整数。';
    else total += Number(spec.stock);
    return spec;
  });
  if ((publish || input.minimum) && (!/^\d{1,6}$/.test(input.minimum) || Number(input.minimum) < 1 || (publish && Number(input.minimum) > total))) errors.minimum = '成团门槛需为正整数，发布时不能超过规格库存合计。';
  const deadline = beijingTime(input.deadline), shipping = beijingTime(input.shippingAt);
  if ((publish || input.deadline) && (!Number.isFinite(deadline) || deadline <= now)) errors.deadline = '请选择晚于当前时间的有效截止时间（北京时间）。';
  if ((publish || input.shippingAt) && (!Number.isFinite(shipping) || (Number.isFinite(deadline) && shipping <= deadline))) errors.shippingAt = '请选择晚于截止时间的有效预计发货时间（北京时间）。';
  return { input, errors };
}
export function groupInput(group: GroupRecord): GroupInput {
  const { title, description, coverId, detailImageIds, minimum, deadline, shippingAt } = group;
  return { title, description, coverId, detailImageIds, minimum, deadline, shippingAt,
    specs: group.specs.map(({ name, price, stock }) => ({ name, price, stock })) };
}
