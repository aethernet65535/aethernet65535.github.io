---
title: "入门级：kfree()"
published: 2025-10-31
description: "浅谈`kfree()`的作用"
tags: ["内存管理", "Linux", "入门级"]
category: Kernel
draft: false
---

# 0. `kfree()`的函数定义
```c
void kfree(const void *x);
```
`kfree()`是一个释放对象/页的函数，简单点来说也可以说是释放内存的函数。
但是内存并不包括页级的非复合页内存，比如`vmalloc()`或批量`alloc_pages()`所分配的内存。

可以这么理解，`kfree()`是和`kmalloc()`绑定的，如果你用了`kmalloc()`，你就应该用`kfree()`，如果不是，那就请找一个更适合的函数，`kfree()`算是一种高级的API，所以通用性较差。

注：`kzalloc()`/`kmalloc_array()`/`kcalloc()`分配的内存也可以被`kfree()`释放。



# 1. 

最后编辑时间：2025/10/31 PM07:08
