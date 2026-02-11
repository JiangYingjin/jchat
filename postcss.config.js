module.exports = {
  plugins: {
    autoprefixer: {
      // 配置 autoprefixer 选项
      grid: true,
      // 支持的浏览器版本
      overrideBrowserslist: [
        "> 0.5%",
        "last 2 versions",
        "not dead",
        "not ie 11",
        "iOS >= 10",
        "Android >= 7",
      ],
      // 禁用某些警告
      flexbox: "no-2009",
      // 处理 end 值兼容性
      cascade: false,
    },
    // 如果需要其他 PostCSS 插件可以在这里添加
    // 'postcss-flexbugs-fixes': {},
  },
};
