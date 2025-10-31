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



# 1. 这个函数怎么用？
和用户空间一样，内存的释放是很重要的，当我们用不到某块内存是就得尽早将其释放。

```c
char *ptr = NULL;

ptr = kmalloc(1024, GFP_KERNEL);
if (!ptr)
	goto err;
/* doing something... */

kfree(ptr); /* 直接传入地址就好了 */
```

还有另一种情况，虽然不怎么常用，但是也可以说一下。
```c
char *ptr = NULL;
kfree(ptr);
```
`kfree(NULL)`是合法的，内核不会处理这次的释放，但是也不会报错。

有一种情况可以保证`kfree()`后犯错的概率大大降低，那便是把指针变为空指针。
```c
kfree(ptr);
ptr = NULL;
```
这样，就不用担心之后犯一些低级错误了。



# 2. 这个函数不可以怎么用？
我们刚刚已经说过了只可以释放`kmalloc()`系列所分配的地址，这里就不重新赘述了。

有一种情况挺常见的，而且也比较难调试，那就是“双重释放”。
\# **为什么不可以双重释放？** <br>
首先我们想象，我们释放了代表什么，代表这块内存可以被其他地方使用，对吧？<br>
所以我们就不能再释放多一次了，那等于是在破坏其他地方，这显然是不对的，同理，释放后也不应该继续使用那块内存，即使没有立即造成错误。

\# **怎么双重释放？** <br>
```c
char *ptr = NULL;

ptr = kmalloc(1024, GFP_KERNEL);
if (!ptr)
	goto err;

kfree(ptr);
kfree(ptr);
```
双重释放一般是会报错的，所以不必担心破坏其他程序。

\# **UAF (USE-AFTER-FREE)** <br>
一般情况下，在内核模块上UAF是很轻松的，因为内存释放需要一个较小的开销，所以并不会用`memset()`这种昂贵的开销来清除数据，所以理论上我们可以读取内核中的其他数据，只是一般来说也没必要就是了。<br>
如果是说攻击者的话，他都到内核层了，为什么不做其他更简单的呢？

```c
char *ptr = NULL;

ptr = kmalloc(1024, GFP_KERNEL);
printk(KERN_DEBUG "uaf_test: ptr[kmalloc] = %px\n", ptr);

kfree(ptr);
strcpy(ptr, "uaf_ok\n");
printk(KERN_DEBUG "uaf_test: ptr[kfree] = %px\n", ptr);
printk(KERN_DEBUG "uaf_test: ptr[string] = %s\n", ptr);
```
这个大概率是可以成功执行的，但是在生产环境中千万不要写这种UAF行为的代码。 <br>
不过用`vmalloc()`的话我就不确定了，毕竟`vmalloc()`的地址转换较为复杂，而`kmalloc()`返回的虚拟地址则是永远指向固定的那一个字节的。 <br>
不过，即使用的是`vmalloc()`，也绝对不要写UAF行为。

最后编辑时间：2025/10/31 PM09:43
