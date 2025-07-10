declare module "*.jpg";
declare module "*.png";
declare module "*.svg";
declare module "*.scss" {
  const content: Record<string, string>;
  export default content;
}
