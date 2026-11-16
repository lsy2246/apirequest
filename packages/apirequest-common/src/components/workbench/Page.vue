<template>
  <section class="workbench-page">
    <div class="workbench-page-content"><slot /></div>
  </section>
</template>

<style scoped>
.workbench-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--primary-light-color);
  scrollbar-gutter: stable;
}
.workbench-page-content {
  flex: none;
  width: 100%;
  max-width: 1280px;
  min-width: 0;
  margin: 0 auto;
  padding: 28px 28px 40px;
}
@media (max-width: 767px) {
  .workbench-page-content {
    padding: 20px 16px 28px;
  }
}
</style>
